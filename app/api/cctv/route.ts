import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

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
        { error: "Vercel 환경 변수에 ITS_API_KEY가 등록되지 않았거나 재배포가 필요합니다." },
        { status: 500 }
      );
    }

    // 반경 약 12km 영역 설정
    const delta = 0.11;
    const minX = (targetLng - delta).toFixed(6);
    const maxX = (targetLng + delta).toFixed(6);
    const minY = (targetLat - delta).toFixed(6);
    const maxY = (targetLat + delta).toFixed(6);

    const fetchCctvByType = async (type: "ex" | "its") => {
      const url = `https://openapi.its.go.kr:9443/cctvInfo?apiKey=${apiKey}&type=${type}&cctvType=1&minX=${minX}&maxX=${maxX}&minY=${minY}&maxY=${maxY}&getType=json`;
      try {
        const res = await fetch(url, {
          cache: "no-store",
          signal: AbortSignal.timeout(6000), // 6초 타임아웃 방어
        });
        if (!res.ok) return [];
        const json = await res.json();
        const rawData = json?.response?.data;
        if (!rawData) return [];
        return Array.isArray(rawData) ? rawData : [rawData];
      } catch (err) {
        console.warn(`[ITS ${type} 호출 실패/타임아웃]:`, err);
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

    // 거리순 정렬 후 최인접 5개 선별
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

    return NextResponse.json({ cctvs: uniqueList });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}