import { NextRequest, NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
export const dynamic = "force-dynamic";

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;

// 6개 감시 지점
export const LOCATIONS = [
  { id: "depot_imun", name: "이문차량사업소", nx: 61, ny: 128, lat: 37.5998, lng: 127.0685 },
  { id: "depot_cheongnyangni", name: "청량리차량사업소", nx: 61, ny: 127, lat: 37.5815, lng: 127.0543 },
  { id: "depot_bundang", name: "분당차량사업소", nx: 62, ny: 122, lat: 37.3134, lng: 127.1062 },
  { id: "depot_pyeongnae", name: "평내차량사업소", nx: 64, ny: 128, lat: 37.6432, lng: 127.2405 },
  { id: "depot_yongmun", name: "용문차량사업소", nx: 71, ny: 125, lat: 37.5147, lng: 127.5701 },
  { id: "depot_bubal", name: "부발차량사업소", nx: 68, ny: 121, lat: 37.2652, lng: 127.5028 },
];

function getKstBaseDateTime() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60 * 1000;
  const kst = new Date(utc + 9 * 60 * 60 * 1000);

  const baseTimes = [2, 5, 8, 11, 14, 17, 20, 23];
  let targetHour = baseTimes[0];
  const currentHour = kst.getHours();
  const currentMin = kst.getMinutes();

  let found = false;
  for (let i = baseTimes.length - 1; i >= 0; i--) {
    if (currentHour > baseTimes[i] || (currentHour === baseTimes[i] && currentMin >= 15)) {
      targetHour = baseTimes[i];
      found = true;
      break;
    }
  }

  if (!found) {
    kst.setDate(kst.getDate() - 1);
    targetHour = 23;
  }

  const baseDate = `${kst.getFullYear()}${String(kst.getMonth() + 1).padStart(2, "0")}${String(kst.getDate()).padStart(2, "0")}`;
  const baseTime = `${String(targetHour).padStart(2, "0")}00`;
  return { baseDate, baseTime };
}

// 신적설량 파싱
function parseSnowfall(snoStr: string): number {
  if (!snoStr || snoStr.includes("없음") || snoStr.includes("-")) return 0;
  if (snoStr.includes("0.1cm 미만") || snoStr.includes("1mm 미만")) return 0.05;
  if (snoStr.includes("1.0cm 미만")) return 0.5;
  if (snoStr.includes("1.0~5.0cm")) return 3.0;
  if (snoStr.includes("5.0cm 이상")) return 5.0;

  const num = parseFloat(snoStr.replace(/[^0-9.]/g, ""));
  return isNaN(num) ? 0 : num;
}

// 하늘상태(SKY) + 강수형태(PTY) 기반 현재 날씨 라벨링
function parseWeatherStatus(skyVal?: string, ptyVal?: string): { text: string; icon: string } {
  if (ptyVal === "3") return { text: "눈", icon: "❄️" };
  if (ptyVal === "2") return { text: "비/눈", icon: "🌨️" };
  if (ptyVal === "1") return { text: "비", icon: "🌧️" };
  if (ptyVal === "4") return { text: "소나기", icon: "🌦️" };
  if (skyVal === "1") return { text: "맑음", icon: "☀️" };
  if (skyVal === "3") return { text: "구름많음", icon: "⛅" };
  if (skyVal === "4") return { text: "흐림", icon: "☁️" };
  return { text: "맑음", icon: "☀️" };
}

export async function GET() {
  try {
    const { baseDate, baseTime } = getKstBaseDateTime();
    const rawApiKey = (process.env.WEATHER_API_KEY || "").trim();
    const baseUrl = (process.env.WEATHER_API_URL || "http://apis.data.go.kr/1360000/VilageFcstInfoService_2.0").replace(/\/$/, "");
    const decodedKey = rawApiKey.includes("%") ? decodeURIComponent(rawApiKey) : rawApiKey;

    let savedData: Record<string, { currentSnow: number; updatedAt: string }> = {};
    if (redis) {
      try {
        savedData = (await redis.get("snow_records")) || {};
      } catch (err) {
        console.error("Redis fetch error:", err);
      }
    }

    const results = await Promise.all(
      LOCATIONS.map(async (loc) => {
        const record = savedData[loc.id] || { currentSnow: 0, updatedAt: "기록 없음" };
        let hourlyForecast: any[] = [];
        let dangerHour: string | null = null;
        let hoursUntilDanger: number | null = null;
        let accumulatedSnow = record.currentSnow;
        let currentWeather = { text: "조회 중", icon: "⏳" };
        let currentTemp = "-";

        if (decodedKey) {
          try {
            const apiUrl = `${baseUrl}/getVilageFcst?serviceKey=${encodeURIComponent(
              decodedKey
            )}&pageNo=1&numOfRows=200&dataType=JSON&base_date=${baseDate}&base_time=${baseTime}&nx=${loc.nx}&ny=${loc.ny}`;

            const kmaRes = await fetch(apiUrl, { next: { revalidate: 600 } });
            const kmaData = await kmaRes.json();
            const items = kmaData?.response?.body?.items?.item || [];

            // 현재와 가장 가까운 시점의 SKY, PTY, TMP(기온) 추출
            const firstFcstTime = items[0]?.fcstTime;
            const currentSky = items.find((it: any) => it.category === "SKY" && it.fcstTime === firstFcstTime)?.fcstValue;
            const currentPty = items.find((it: any) => it.category === "PTY" && it.fcstTime === firstFcstTime)?.fcstValue;
            const tempVal = items.find((it: any) => it.category === "TMP" && it.fcstTime === firstFcstTime)?.fcstValue;

            currentWeather = parseWeatherStatus(currentSky, currentPty);
            if (tempVal) currentTemp = `${tempVal}℃`;

            // 신적설량(SNO) 계산
            const snoItems = items
              .filter((it: any) => it.category === "SNO")
              .sort((a: any, b: any) => `${a.fcstDate}${a.fcstTime}`.localeCompare(`${b.fcstDate}${b.fcstTime}`));

            for (let i = 0; i < snoItems.length; i++) {
              const item = snoItems[i];
              const added = parseSnowfall(item.fcstValue);
              accumulatedSnow = Number((accumulatedSnow + added).toFixed(2));

              hourlyForecast.push({
                time: `${item.fcstDate.slice(4, 6)}/${item.fcstDate.slice(6, 8)} ${item.fcstTime.slice(0, 2)}:00`,
                sno: added,
                total: accumulatedSnow,
              });

              if (accumulatedSnow >= 10 && dangerHour === null) {
                dangerHour = `${item.fcstDate.slice(4, 6)}월 ${item.fcstDate.slice(6, 8)}일 ${item.fcstTime.slice(0, 2)}시`;
                hoursUntilDanger = i + 1;
              }
            }
          } catch (e) {
            console.error(`기상청 API 오류 (${loc.name}):`, e);
          }
        }

        // 특보/경보 등급 산출
        let alertLevel = "정상";
        if (dangerHour !== null) {
          alertLevel = "🚨 10cm 위험 경보";
        } else if (accumulatedSnow >= 5) {
          alertLevel = "⚠️ 대설주의보 기준";
        } else if (hourlyForecast.some((f) => f.sno > 0)) {
          alertLevel = "❄️ 눈 예보";
        }

        return {
          id: loc.id,
          name: loc.name,
          lat: loc.lat,
          lng: loc.lng,
          currentSnow: record.currentSnow,
          updatedAt: record.updatedAt,
          currentWeather,
          currentTemp,
          alertLevel,
          isDanger: dangerHour !== null,
          dangerHour,
          hoursUntilDanger,
          finalExpectedSnow: accumulatedSnow,
          hourlyForecast: hourlyForecast.slice(0, 8),
        };
      })
    );

    const formattedBaseTime = `${baseDate.slice(0, 4)}-${baseDate.slice(4, 6)}-${baseDate.slice(6, 8)} ${baseTime.slice(0, 2)}:${baseTime.slice(2, 4)}`;

    return NextResponse.json({
      baseDateTime: `${baseDate} ${baseTime}`,
      formattedBaseTime,
      locations: results,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { locationId, currentSnow } = await req.json();

    if (!locationId || currentSnow === undefined || isNaN(Number(currentSnow))) {
      return NextResponse.json({ error: "올바른 구역과 적설량을 입력해주세요." }, { status: 400 });
    }

    if (!redis) {
      return NextResponse.json({ error: "Upstash Redis 연결 실패" }, { status: 500 });
    }

    const savedData: Record<string, any> = (await redis.get("snow_records")) || {};
    const now = new Date();
    const kstNow = new Date(now.getTime() + now.getTimezoneOffset() * 60 * 1000 + 9 * 60 * 60 * 1000);
    const updatedTimeStr = `${kstNow.getMonth() + 1}/${kstNow.getDate()} ${String(kstNow.getHours()).padStart(2, "0")}:${String(kstNow.getMinutes()).padStart(2, "0")}`;

    savedData[locationId] = {
      currentSnow: Number(currentSnow),
      updatedAt: updatedTimeStr,
    };

    await redis.set("snow_records", savedData);
    return NextResponse.json({ success: true, updated: savedData[locationId] });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
