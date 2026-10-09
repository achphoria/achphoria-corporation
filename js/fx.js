/* Suasana v5: fase hari dari jam WIB (dipakai pencahayaan 3D & ritme maskot) dan papan "Hari ini".
   Efek visual (lampion, uap, monitor, LED, ring light, cahaya siang/malam) kini digambar scene3d.js. */
(function () {
  const ACH = window.ACH;
  const fx = (ACH.fx = {});

  // fase hari dari jam WIB → nilai 0..1 untuk tiap suasana (ikut ?jam= untuk pratinjau)
  fx.dayPhase = function (date) {
    const { h } = ACH.wibNow(date);
    const q = new URLSearchParams(location.search).get('jam');
    const hh = q !== null && q !== '' && !isNaN(+q) ? +q : h;
    const sm = (a, b, x) => ACH.clamp((x - a) / (b - a), 0, 1);
    const night = Math.max(1 - sm(5, 6.5, hh), sm(18.3, 19.6, hh));
    const golden = Math.min(sm(15.5, 17, hh), 1 - sm(18.2, 19.2, hh));
    const day = Math.min(sm(6.5, 8.5, hh), 1 - sm(15.5, 17.2, hh));
    return { h: hh, night, golden, day };
  };
  let phase = fx.dayPhase();
  setInterval(() => (phase = fx.dayPhase()), 30000);
  fx.phase = () => phase;

  // papan "HARI INI · 本日" di papan tulis ruang bersama
  let lastBoard = '';
  fx.setBoard = function (info) {
    const key = JSON.stringify(info || {});
    if (key === lastBoard) return;
    lastBoard = key;
    if (ACH.scene3d && ACH.scene3d.ok) ACH.scene3d.setBoard(info);
    else setTimeout(() => { lastBoard = ''; fx.setBoard(info); }, 1500); // scene belum siap → coba lagi
  };
})();
