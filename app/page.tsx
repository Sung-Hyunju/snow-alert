"use client";

import { useEffect, useState } from "react";

import {
  AlertTriangle,
  CheckCircle,
  CloudSnow,
  RefreshCw,
  PlusCircle,
  Share2,
  Thermometer,
  Clock,
} from "lucide-react";
import CctvModal from "./components/CctvModal";

export default function DashboardPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState<string>("");

  const [selectedLoc, setSelectedLoc] = useState("loc_ddm1");
  const [inputSnow, setInputSnow] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [activeCctv, setActiveCctv] = useState<{ name: string; lat: number; lng: number } | null>(null);
  
  //시계 타이머
  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, "0");
      const day = String(now.getDate()).padStart(2, "0");
      const hours = String(now.getHours()).padStart(2, "0");
      const minutes = String(now.getMinutes()).padStart(2, "0");
      const seconds = String(now.getSeconds()).padStart(2, "0");
      setCurrentTime(`${year}-${month}-${day} ${hours}:${minutes}:${seconds}`);
    };

    updateClock(); // 켜지자마자 즉시 실행
    const timer = setInterval(updateClock, 1000);
    return () => clearInterval(timer);
  }, []);

  // 스마트 자동 갱신 (5분 주기 + 탭 보고 있을 때만 동작)
  useEffect(() => {
    fetchData(); // 처음 접속 시 1회 호출

    const INTERVAL_TIME = 1000 * 60 * 5; // 5분 주기 (완전 안전)

    const timer = setInterval(() => {
      // 사용자가 이 브라우저 탭을 보고 있을 때만 서버 호출 (절전 모드)
      if (document.visibilityState === "visible") {
        fetchData();
      }
    }, INTERVAL_TIME);

    // 탭을 다시 클릭해서 돌아왔을 때 즉시 1회 최신화
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        fetchData();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/snow", { cache: "no-store" });
      const json = await res.json();
      setData(json);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputSnow) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/snow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locationId: selectedLoc, currentSnow: parseFloat(inputSnow) }),
      });

      const result = await res.json();
      if (res.ok) {
        setInputSnow("");
        await fetchData();
        alert("적설량이 업데이트되었습니다!");
      } else {
        alert(`저장 실패: ${result.error || "알 수 없는 오류"}`);
      }
    } catch (e: any) {
      alert(`네트워크 오류: ${e.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const hasAnyDanger = data?.locations?.some((loc: any) => loc.isDanger);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-4 sm:p-6 lg:p-8 font-sans max-w-7xl mx-auto">
      {/* 상단 헤더 & 종합 상황 배너 */}
      <header className="mb-6 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-blue-500/20 text-blue-400 rounded-2xl">
              <CloudSnow className="w-8 h-8" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-black tracking-tight">적설 비상 통합 모니터링</h1>
              <p className="text-xs sm:text-sm text-slate-400">
                실시간 기상청 예보 및 6개 구역 10cm 도달 위험 분석
              </p>
            </div>
          </div>

          {/* 시간 안내 + 새로고침 버튼 영역 */}
          <div className="flex items-center justify-between md:justify-end gap-3 bg-slate-900/80 border border-slate-800 p-2.5 sm:px-4 sm:py-2.5 rounded-2xl">
            <div className="text-left md:text-right text-[11px] sm:text-xs leading-tight font-mono space-y-0.5">
              <div className="flex items-center md:justify-end gap-1.5 text-slate-300">
                <span className="text-slate-500 text-[10px]">현재 시각:</span>
                <span className="font-semibold text-slate-200">{currentTime || "로딩 중..."}</span>
              </div>
              <div className="flex items-center md:justify-end gap-1.5 text-slate-400">
                <span className="text-slate-500 text-[10px]">기상청 발표:</span>
                <span className="font-semibold text-blue-400">
                  {data?.formattedBaseTime || "조회 중..."}
                </span>
              </div>
            </div>

            <button
              onClick={fetchData}
              disabled={loading}
              className="flex items-center space-x-1.5 px-3 py-2 bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 rounded-xl transition text-xs font-semibold cursor-pointer shrink-0"
              title="데이터 즉시 갱신"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">새로고침</span>
            </button>
          </div>
        </div>

        {/* 종합 비상 신호등 */}
        <div
          className={`p-4 sm:p-5 rounded-2xl border flex items-center justify-between shadow-xl transition ${
            hasAnyDanger
              ? "bg-red-950/60 border-red-700/80 text-red-200"
              : "bg-emerald-950/40 border-emerald-800 text-emerald-200"
          }`}
        >
          <div className="flex items-center space-x-3.5">
            {hasAnyDanger ? (
              <AlertTriangle className="w-8 h-8 text-red-400 shrink-0 animate-bounce" />
            ) : (
              <CheckCircle className="w-8 h-8 text-emerald-400 shrink-0" />
            )}
            <div>
              <p className="font-extrabold text-base sm:text-lg">
                {hasAnyDanger ? "⚠️ 10cm 도달 위험 구역 발생!" : "현재 전 구역 안전 상태"}
              </p>
              <p className="text-xs sm:text-sm text-slate-300 mt-0.5">
                {hasAnyDanger
                  ? "비상 시간이 예보된 구역의 제설 장비 및 인력 배치를 준비하세요."
                  : "현재 향후 10cm 누적 돌파가 예상되는 구역이 없습니다."}
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              navigator.clipboard.writeText(window.location.href);
              alert("대시보드 주소가 복사되었습니다! 카톡 단톡방 상단 공지에 등록하세요.");
            }}
            className="hidden sm:flex items-center space-x-1 px-3 py-2 bg-black/30 hover:bg-black/50 rounded-xl text-xs text-slate-300 cursor-pointer"
          >
            <Share2 className="w-3.5 h-3.5" />
            <span>단톡방 링크 복사</span>
          </button>
        </div>
      </header>

      {/* 6개 구역 카드 그리드 */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-5">
        {data?.locations?.map((loc: any) => (
          <div
            key={loc.id}
            className={`bg-slate-900 border rounded-2xl p-5 shadow-lg flex flex-col justify-between transition hover:border-slate-600 ${
              loc.isDanger
                ? "border-amber-500/80 ring-1 ring-amber-500/30"
                : "border-slate-800"
            }`}
          >
            <div>
              <div className="flex justify-between items-start mb-2.5">
                <div>
                  <h2 className="text-base font-bold text-white tracking-tight">{loc.name}</h2>
                  <p className="text-[11px] text-slate-400">마지막 실측: {loc.updatedAt}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveCctv({ name: loc.name, lat: loc.lat, lng: loc.lng })}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] text-blue-400 font-medium transition cursor-pointer"
                >
                  근처 CCTV 보기
                </button>
                <span
                  className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${
                    loc.isDanger
                      ? "bg-red-500/20 text-red-300 border-red-500/40"
                      : loc.alertLevel.includes("주의보")
                      ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                      : loc.alertLevel.includes("눈")
                      ? "bg-blue-500/20 text-blue-300 border-blue-500/40"
                      : "bg-slate-800 text-slate-400 border-slate-700"
                  }`}
                >
                  {loc.alertLevel}
                </span>
              </div>

              <div className="flex items-center justify-between bg-slate-950/70 p-3 rounded-xl border border-slate-800/80 mb-3">
                <div className="flex items-center space-x-2 text-xs text-slate-300">
                  <span className="text-base">{loc.currentWeather?.icon}</span>
                  <span className="font-semibold text-slate-200">{loc.currentWeather?.text}</span>
                  <span className="text-slate-500">|</span>
                  <span className="flex items-center text-slate-400">
                    <Thermometer className="w-3 h-3 mr-0.5" />
                    {loc.currentTemp}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-xs text-slate-400 mr-1.5 font-medium">현재 적설</span>
                  <span className="text-xl font-black text-blue-400">{loc.currentSnow}</span>
                  <span className="text-xs text-slate-400 ml-0.5">cm</span>
                </div>
              </div>

              {loc.isDanger ? (
                <div className="p-3 bg-amber-500/15 border border-amber-500/40 rounded-xl mb-3">
                  <p className="text-xs font-bold text-amber-300 flex items-center space-x-1.5">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                    <span>
                      약 {loc.hoursUntilDanger}시간 후 ({loc.dangerHour}) 10cm 돌파 위험!
                    </span>
                  </p>
                </div>
              ) : (
                <div className="p-2.5 bg-slate-800/50 rounded-xl mb-3 text-xs text-slate-300 flex justify-between">
                  <span>예보 기간 내 최대 예상:</span>
                  <span className="font-bold text-white">{loc.finalExpectedSnow} cm</span>
                </div>
              )}
            </div>

            <div>
              <p className="text-[10px] text-slate-400 mb-1 font-medium">향후 예상 누적 적설량 (시간당 신적설)</p>
              <div className="flex space-x-2 overflow-x-auto pb-1 text-center text-[11px] scrollbar-none">
                {loc.hourlyForecast?.map((f: any, idx: number) => (
                  <div
                    key={idx}
                    className={`shrink-0 px-2 py-1 rounded-lg border ${
                      f.total >= 10
                        ? "bg-amber-950/50 border-amber-600/70 text-amber-200 font-bold"
                        : "bg-slate-800/60 border-slate-700/50 text-slate-300"
                    }`}
                  >
                    <p className="text-[10px] text-slate-400">{f.time.split(" ")[1]}</p>
                    <p className="font-semibold">{f.total}cm</p>
                    <p className="text-[9px] text-blue-400 font-normal">+{f.sno}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </section>

      {/* 당번용 실측 업데이트 패널 */}
      <section className="mt-8 bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-2xl">
        <div className="max-w-2xl mx-auto">
          <h3 className="text-sm font-bold text-slate-200 flex items-center space-x-1.5 mb-3">
            <PlusCircle className="w-4 h-4 text-blue-400" />
            <span>실측 적설량 업데이트 (2시간 주기 당번용)</span>
          </h3>
          <form onSubmit={handleUpdate} className="flex flex-col sm:flex-row gap-2.5">
            <div className="flex-1">
              <select
                value={selectedLoc}
                onChange={(e) => setSelectedLoc(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-xs text-white focus:ring-1 focus:ring-blue-500"
              >
                {data?.locations?.map((l: any) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="w-full sm:w-36">
              <input
                type="number"
                step="0.1"
                min="0"
                value={inputSnow}
                onChange={(e) => setInputSnow(e.target.value)}
                placeholder="적설량 (cm)"
                className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-xs text-white focus:ring-1 focus:ring-blue-500"
                required
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="py-2.5 px-5 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 rounded-xl font-bold text-xs transition duration-150 cursor-pointer disabled:opacity-50 shrink-0"
            >
              {submitting ? "저장 중..." : "기록 & 위험 재계산"}
            </button>
          </form>
        </div>
      </section>
      {activeCctv && (
  <CctvModal
    locationName={activeCctv.name}
    lat={activeCctv.lat}
    lng={activeCctv.lng}
    onClose={() => setActiveCctv(null)}
  />
)}
    </main>
  );
}