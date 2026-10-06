import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const latStr = searchParams.get("lat");
    const lngStr = searchParams.get("lng");

    if (!latStr || !lngStr) {
      return NextResponse.json({ error: "위도/경도 파라미터가 누락되었습니다." }, { status: 400 });
    }

    const targetLat = parseFloat(latStr);
    const targetLng = parseFloat(lngStr);
    const apiKey = process.env.ITS_API_KEY;

    console.log("-----------------------------------------");
    console.log("📍 [CCTV 요청] 위도:", targetLat, "경도:", targetLng);
    console.log("🔑 [ITS 키 확인]:", apiKey ? `등록됨 (${apiKey.substring(0, 6)}...)` : "❌ 없음 (undefined)");

    if (!apiKey) {
      return NextResponse.json(
        { error: "ITS_API_KEY가 없습니다. .env.local 작성 후 npm run dev를 재시작했는지 확인하세요." },
        { status: 500 }
      );
    }

    // 검색 반경 약 12km (0.11도)로 넉넉히 설정
    const delta = 0.11;
    const minX = (targetLng - delta).toFixed(6);
    const maxX = (targetLng + delta).toFixed(6);
    const minY = (targetLat - delta).toFixed(6);
    const maxY = (targetLat + delta).toFixed(6);

    const fetchCctvByType = async (type: "ex" | "its") => {
      // coordtype=1 (WGS84 좌표계 지정 필수)
      const url = `https://openapi.its.go.kr:9443/cctvInfo?apiKey=${apiKey}&type=${type}&cctvType=1&minX=${minX}&maxX=${maxX}&minY=${minY}&maxY=${maxY}&getType=json`;
      
      try {
        const res = await fetch(url, { next: { revalidate: 300 } });
        const json = await res.json();

        // ⚠️ ITS API 자체 에러 응답 체크 (결과코드가 99, 10 등인 경우)
        const header = json?.response?.header;
        if (header && header.resultCode && header.resultCode !== "0" && header.resultCode !== "00") {
          console.error(`🚨 [ITS ${type} 에러 응답]:`, header.resultMsg, `(코드: ${header.resultCode})`);
          return { errorMsg: `[ITS API 오류] ${header.resultMsg} (코드: ${header.resultCode})` };
        }

        const rawData = json?.response?.data;
        if (!rawData) return { list: [] };
        return { list: Array.isArray(rawData) ? rawData : [rawData] };
      } catch (err: any) {
        console.error(`🚨 [ITS ${type} 네트워크/파싱 에러]:`, err.message);
        return { errorMsg: `통신 에러: ${err.message}` };
      }
    };

    // 고속도로(ex)와 일반국도(its) 동시 호출
    const [exRes, itsRes] = await Promise.all([
      fetchCctvByType("ex"),
      fetchCctvByType("its"),
    ]);

    // 두 요청 중 API 에러 메시지가 있다면 모달 화면에 그대로 노출
    if (exRes.errorMsg || itsRes.errorMsg) {
      const err = exRes.errorMsg || itsRes.errorMsg;
      return NextResponse.json({ error: err }, { status: 400 });
    }

    const combined = [...(exRes.list || []), ...(itsRes.list || [])];

    if (combined.length === 0) {
      return NextResponse.json({ cctvs: [] });
    }

    const withDistance = combined
      .filter((item: any) => item?.cctvurl && item?.coordy && item?.coordx)
      .map((item: any) => {
        const itemLat = parseFloat(item.coordy);
        const itemLng = parseFloat(item.coordx);

        // 위경도 차이를 대략적인 km로 환산 (위도 1도 ≈ 111km, 경도 1도 ≈ 88km)
        const dLat = (itemLat - targetLat) * 111;
        const dLng = (itemLng - targetLng) * 88;
        const distanceKm = Math.sqrt(dLat * dLat + dLng * dLng);

        return {
          name: item.cctvname,
          url: item.cctvurl,
          distanceKm: distanceKm,
        };
      });

    // 2. 가장 가까운 거리순으로 정렬
    withDistance.sort((a, b) => a.distanceKm - b.distanceKm);

    // 3. 중복 카메라명 제거 (상/하행선 등으로 이름이 겹치는 경우 방지)
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
      // 👈 원하는 개수(예: 최인접 5개)만 채워지면 중단
      if (uniqueList.length >= 5) break;
    }

    return NextResponse.json({ cctvs: uniqueList });
  } catch (error: any) {
    console.error("서버 내부 예외:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}