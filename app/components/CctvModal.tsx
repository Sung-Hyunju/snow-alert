"use client";

import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";

interface CCTVItem {
  name: string;
  url: string;
}

interface CctvModalProps {
  locationName: string;
  lat: number;
  lng: number;
  onClose: () => void;
}

export default function CctvModal({ locationName, lat, lng, onClose }: CctvModalProps) {
  const [cctvList, setCctvList] = useState<CCTVItem[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);

  useEffect(() => {
  async function loadCCTV() {
    setLoading(true);
    setErrorMsg("");
    try {
      const apiKey = process.env.ITS_API_KEY;
      if (!apiKey) {
        setErrorMsg("ITS_API_KEY가 설정되지 않았습니다.");
        return;
      }

      const delta = 0.11;
      const minX = (lng - delta).toFixed(6);
      const maxX = (lng + delta).toFixed(6);
      const minY = (lat - delta).toFixed(6);
      const maxY = (lat + delta).toFixed(6);

      const fetchCctv = async (type: "ex" | "its") => {
        const res = await fetch(
          `https://openapi.its.go.kr/cctvInfo?apiKey=${apiKey}&type=${type}&cctvType=1&minX=${minX}&maxX=${maxX}&minY=${minY}&maxY=${maxY}&getType=json`
        );
        if (!res.ok) return [];
        const json = await res.json();
        const raw = json?.response?.data;
        return raw ? (Array.isArray(raw) ? raw : [raw]) : [];
      };

      const [exList, itsList] = await Promise.all([fetchCctv("ex"), fetchCctv("its")]);
      const combined = [...exList, ...itsList];

      if (combined.length === 0) {
        setErrorMsg("인근 국가 도로망 CCTV 데이터가 없습니다.");
        return;
      }

      // 거리순 정렬 후 상위 5개 추출
      const formatted = combined
        .filter((item: any) => item?.cctvurl && item?.coordy && item?.coordx)
        .map((item: any) => {
          const dLat = (parseFloat(item.coordy) - lat) * 111;
          const dLng = (parseFloat(item.coordx) - lng) * 88;
          return {
            name: item.cctvname,
            url: item.cctvurl,
            distanceKm: Math.sqrt(dLat * dLat + dLng * dLng),
          };
        })
        .sort((a, b) => a.distanceKm - b.distanceKm)
        .slice(0, 5)
        .map((item) => ({
          name: `${item.name} (${item.distanceKm.toFixed(1)}km)`,
          url: item.url,
        }));

      setCctvList(formatted);
      setSelectedIdx(0);
    } catch (err: any) {
      setErrorMsg(`CCTV 연결 실패: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  loadCCTV();
}, [lat, lng]);

  useEffect(() => {
    if (!cctvList[selectedIdx] || !videoRef.current) return;

    const currentUrl = cctvList[selectedIdx].url;
    const video = videoRef.current;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
      hls.loadSource(currentUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {});
      });
      hlsRef.current = hls;
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = currentUrl;
      video.addEventListener("loadedmetadata", () => {
        video.play().catch(() => {});
      });
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [cctvList, selectedIdx]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* 모달 헤더 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-950/50">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
            <h3 className="font-bold text-base text-white">
              {locationName} 인근 실시간 도로 CCTV
            </h3>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* 비디오 뷰어 영역 */}
        <div className="relative aspect-video bg-black flex flex-col items-center justify-center">
          {loading && (
            <div className="text-sm text-slate-400 flex items-center gap-2">
              <span className="animate-spin">⏳</span> CCTV 영상 스트림 연결 중...
            </div>
          )}

          {errorMsg && !loading && (
            <div className="text-center p-6 space-y-3">
              <p className="text-sm text-amber-400 font-medium">{errorMsg}</p>
              <a
                href={`https://map.kakao.com/link/map/${encodeURIComponent(locationName + " 주변")},${lat},${lng}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block px-4 py-2 bg-slate-800 hover:bg-slate-700 text-blue-400 border border-slate-700 rounded-lg text-xs font-semibold transition"
              >
                🗺️ 카카오맵 CCTV 레이어로 보기
              </a>
            </div>
          )}

          <video
            ref={videoRef}
            controls
            autoPlay
            muted
            playsInline
            className={`w-full h-full object-contain ${loading || errorMsg ? "hidden" : "block"}`}
          />
        </div>

        {/* 푸터: 카메라 선택기 */}
        {cctvList.length > 0 && (
          <div className="p-4 border-t border-slate-800 bg-slate-950/50 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-400">
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <span>카메라:</span>
              <select
                value={selectedIdx}
                onChange={(e) => setSelectedIdx(Number(e.target.value))}
                className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-xs outline-none focus:ring-1 focus:ring-blue-500 flex-1 sm:flex-initial"
              >
                {cctvList.map((c, i) => (
                  <option key={i} value={i}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <span className="text-[11px] text-slate-500">제공: 국가교통정보센터 (ITS)</span>
          </div>
        )}
      </div>
    </div>
  );
}