import { NextRequest, NextResponse } from "next/server";
import { Redis } from "@upstash/redis";

// ⚠️ Next.js가 API 전체를 정적 캐시로 굳히지 못하도록 강제 동적 설정 (필수!)
export const dynamic = "force-dynamic";

let redis: Redis | null = null;
if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const latStr = searchParams.get("lat");
    const lngStr = searchParams.get("lng");

    if (!latStr || !lngStr) {
      return NextResponse.json({ error: "위도와 경도 정보가 필요합니다." }, { status: 400 });
    }

    const targetLat = parseFloat(latStr);
    const targetLng = parseFloat(lngStr);
    const apiKey = process.env.ITS_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "ITS_API_KEY 환경 변수가 설정되지 않았습니다." },
        { status: 500 }
      );
    }

    // 1. 지점 좌표별 고유 캐시 키 생성 (지점마다 캐시 분리)
    const cacheKey = `cctv_${targetLat.toFixed(4)}_${targetLng.toFixed(4)}`;

    // 2. Redis 캐시 확인 (해당 지점에 5분 이내 조회된 데이터가 있으면 반환)
    if (redis) {
      try {
        const cached = await redis.get<any[]>(cacheKey);
        if (cached && Array.isArray(cached) && cached.length > 0) {
          return NextResponse.json({ cctvs: cached, source: "cache" });
        }
      } catch (cacheErr) {
        console.warn("Redis 캐시 확인 실패, 실시간 호출로 진행:", cacheErr);
      }
    }

    // 3. 캐시가 없을 때만 국가교통정보센터(ITS) 호출 (검색 반경 약 12km)
    const delta = 0.11;
    const minX = (targetLng - delta).toFixed(6);
    const maxX = (targetLng + delta).toFixed(6);
    const minY = (targetLat - delta).toFixed(6);
    const maxY = (targetLat + delta).toFixed(6);

   const fetchCctvByType = async (type: "ex" | "its") => {
  const url =
    `https://openapi.its.go.kr:9443/cctvInfo` +
    `?apiKey=${encodeURIComponent(apiKey)}` +
    `&type=${type}` +
    `&cctvType=1` +
    `&minX=${minX}` +
    `&maxX=${maxX}` +
    `&minY=${minY}` +
    `&maxY=${maxY}` +
    `&getType=json`;

  try {
    console.log(`[CCTV] ${type} 요청 시작`, url.replace(apiKey, "***"));

    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });

    console.log(`[CCTV] ${type} 응답`, res.status);

    if (!res.ok) {
      const text = await res.text();
      console.error(`[CCTV] ${type} HTTP 오류`, res.status, text);
      return [];
    }

    const json = await res.json();

    const rawData = json?.response?.data;

    if (!rawData) {
      console.warn(`[CCTV] ${type} 데이터 없음`, json);
      return [];
    }

    return Array.isArray(rawData) ? rawData : [rawData];
  } catch (error: any) {
    console.error(`[CCTV] ${type} FETCH 실패`, {
      message: error?.message,
      name: error?.name,
      cause: error?.cause,
      code: error?.cause?.code,
      errno: error?.cause?.errno,
      syscall: error?.cause?.syscall,
      hostname: error?.cause?.hostname,
    });

    return [];
  }
};

    const [exList, itsList] = await Promise.all([
      fetchCctvByType("ex"),
      fetchCctvByType("its"),
    ]);

    const combined = [...exList, ...itsList];

    if (combined.length === 0) {
      return NextResponse.json({ cctvs: [] });
    }

    // 4. 거리 계산 및 정렬
    const withDistance = combined
      .filter((item: any) => item?.cctvurl && item?.coordy && item?.coordx)
      .map((item: any) => {
        const itemLat = parseFloat(item.coordy);
        const itemLng = parseFloat(item.coordx);
        const dLat = (itemLat - targetLat) * 111;
        const dLng = (itemLng - targetLng) * 88;
        return {
          name: item.cctvname,
          url: item.cctvurl,
          distanceKm: Math.sqrt(dLat * dLat + dLng * dLng),
        };
      })
      .sort((a, b) => a.distanceKm - b.distanceKm);

    // 5. 중복 카메라명 제거 및 최인접 5개 선별
    const uniqueList: any[] = [];
    const seenNames = new Set<string>();

    for (const item of withDistance) {
      if (!seenNames.has(item.name)) {
        seenNames.add(item.name);
        uniqueList.push({
          name: `${item.name} (${item.distanceKm.toFixed(1)}km)`,
          url: item.url,
        });
      }
      if (uniqueList.length >= 5) break;
    }

    // 6. Redis에 해당 지점 결과만 5분(300초) 저장
    if (redis && uniqueList.length > 0) {
      try {
        await redis.set(cacheKey, uniqueList, { ex: 300 });
      } catch (saveErr) {
        console.warn("Redis 캐시 저장 실패:", saveErr);
      }
    }

    return NextResponse.json({ cctvs: uniqueList, source: "live" });
  } catch (error: any) {
  console.error("CCTV API 전체 오류:", error);
  console.error("CCTV API error cause:", error?.cause);

  return NextResponse.json(
    {
      error: error?.message || "알 수 없는 오류",
      cause: error?.cause
        ? {
            code: error.cause.code,
            message: error.cause.message,
            errno: error.cause.errno,
            syscall: error.cause.syscall,
            hostname: error.cause.hostname,
          }
        : undefined,
    },
    { status: 500 }
  );
}
}