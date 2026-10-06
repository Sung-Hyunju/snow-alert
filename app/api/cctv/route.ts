import { NextRequest, NextResponse } from "next/server";
import { Redis } from "@upstash/redis";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

let redis: Redis | null = null;

if (
  process.env.UPSTASH_REDIS_REST_URL &&
  process.env.UPSTASH_REDIS_REST_TOKEN
) {
  redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
}

interface CctvRawItem {
  cctvname?: string;
  cctvurl?: string;
  coordx?: string | number;
  coordy?: string | number;
}

interface CctvItem {
  name: string;
  url: string;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const latStr = searchParams.get("lat");
    const lngStr = searchParams.get("lng");

    if (!latStr || !lngStr) {
      return NextResponse.json(
        { error: "위도와 경도 정보가 필요합니다." },
        { status: 400 }
      );
    }

    const targetLat = Number(latStr);
    const targetLng = Number(lngStr);

    if (!Number.isFinite(targetLat) || !Number.isFinite(targetLng)) {
      return NextResponse.json(
        { error: "위도 또는 경도 값이 올바르지 않습니다." },
        { status: 400 }
      );
    }

    const workerUrl = process.env.CCTV_WORKER_URL;

    if (!workerUrl) {
      return NextResponse.json(
        {
          error:
            "CCTV_WORKER_URL 환경 변수가 설정되지 않았습니다.",
        },
        { status: 500 }
      );
    }

    // --------------------------------------------------
    // 1. 캐시
    // --------------------------------------------------

    const cacheKey = `cctv_${targetLat.toFixed(4)}_${targetLng.toFixed(4)}`;

    if (redis) {
      try {
        const cached = await redis.get<CctvItem[]>(cacheKey);

        if (cached && Array.isArray(cached) && cached.length > 0) {
          return NextResponse.json({
            cctvs: cached,
            source: "cache",
          });
        }
      } catch (error) {
        console.warn("Redis 캐시 조회 실패:", error);
      }
    }

    // --------------------------------------------------
    // 2. 검색 영역
    //
    // 처음부터 너무 큰 영역을 ITS에 요청하지 않고
    // 약 ±0.03도 정도로 시작
    // --------------------------------------------------

    const delta = 0.03;

    const minX = (targetLng - delta).toFixed(6);
    const maxX = (targetLng + delta).toFixed(6);
    const minY = (targetLat - delta).toFixed(6);
    const maxY = (targetLat + delta).toFixed(6);

    // --------------------------------------------------
    // 3. Cloudflare Worker 호출
    // --------------------------------------------------

    const fetchCctvByType = async (type: "ex" | "its") => {
      try {
        const controller = new AbortController();

        const timeout = setTimeout(() => {
          controller.abort();
        }, 30000);

        const response = await fetch(workerUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            type,
            minX,
            maxX,
            minY,
            maxY,
          }),
          cache: "no-store",
          signal: controller.signal,
        });

        clearTimeout(timeout);

        const text = await response.text();

        let json: any;

        try {
          json = JSON.parse(text);
        } catch {
          console.error("Worker가 JSON이 아닌 응답을 반환:", text);

          return [];
        }

        if (!response.ok) {
          console.error("Worker CCTV 오류:", {
            type,
            status: response.status,
            response: json,
          });

          return [];
        }

        if (!Array.isArray(json.data)) {
          console.warn("Worker CCTV 데이터가 배열이 아님:", json);

          return [];
        }

        return json.data as CctvRawItem[];
      } catch (error: any) {
        console.error(`Worker ${type} 호출 실패:`, {
          message: error?.message,
          name: error?.name,
        });

        return [];
      }
    };

    // --------------------------------------------------
    // 4. ex / its 독립적으로 호출
    // --------------------------------------------------

    const [exList, itsList] = await Promise.all([
      fetchCctvByType("ex"),
      fetchCctvByType("its"),
    ]);

    const combined = [...exList, ...itsList];

    // --------------------------------------------------
    // 5. 거리 계산
    // --------------------------------------------------

    const withDistance = combined
      .filter(
        (item) =>
          item?.cctvurl &&
          item?.coordx !== undefined &&
          item?.coordy !== undefined
      )
      .map((item) => {
        const itemLat = Number(item.coordy);
        const itemLng = Number(item.coordx);

        if (!Number.isFinite(itemLat) || !Number.isFinite(itemLng)) {
          return null;
        }

        const dLat = (itemLat - targetLat) * 111;
        const dLng = (itemLng - targetLng) * 88;

        const distanceKm = Math.sqrt(
          dLat * dLat + dLng * dLng
        );

        return {
          name: item.cctvname || "이름 없는 CCTV",
          url: item.cctvurl!,
          distanceKm,
        };
      })
      .filter(
        (
          item
        ): item is {
          name: string;
          url: string;
          distanceKm: number;
        } => item !== null
      )
      .sort((a, b) => a.distanceKm - b.distanceKm);

    // --------------------------------------------------
    // 6. CCTV 이름 중복 제거 + 가까운 5개
    // --------------------------------------------------

    const uniqueList: CctvItem[] = [];
    const seenNames = new Set<string>();

    for (const item of withDistance) {
      if (seenNames.has(item.name)) {
        continue;
      }

      seenNames.add(item.name);

      uniqueList.push({
        name: `${item.name} (${item.distanceKm.toFixed(1)}km)`,
        url: item.url,
      });

      if (uniqueList.length >= 5) {
        break;
      }
    }

    // --------------------------------------------------
    // 7. Redis 캐시
    // --------------------------------------------------

    if (redis && uniqueList.length > 0) {
      try {
        await redis.set(cacheKey, uniqueList, {
          ex: 300,
        });
      } catch (error) {
        console.warn("Redis 캐시 저장 실패:", error);
      }
    }

    // --------------------------------------------------
    // 8. 결과
    // --------------------------------------------------

    if (uniqueList.length === 0) {
      return NextResponse.json({
        cctvs: [],
        source: "worker",
        message: "주변 CCTV를 찾지 못했습니다.",
      });
    }

    return NextResponse.json({
      cctvs: uniqueList,
      source: "worker",
    });
  } catch (error: any) {
    console.error("CCTV API 전체 오류:", error);

    return NextResponse.json(
      {
        error: error?.message || "CCTV API 오류",
      },
      { status: 500 }
    );
  }
}