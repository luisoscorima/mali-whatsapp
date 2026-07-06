const WAVE_TOP =
  "url('https://front-end-noobs.com/jecko/img/wave-top.png')"
const WAVE_MID =
  "url('https://front-end-noobs.com/jecko/img/wave-mid.png')"
const WAVE_BOT =
  "url('https://front-end-noobs.com/jecko/img/wave-bot.png')"

export function WaveBackground() {
  return (
    <div className="waveWrapper waveAnimation" aria-hidden>
      <div className="waveWrapperInner bgTop">
        <div className="wave waveTop" style={{ backgroundImage: WAVE_TOP }} />
      </div>
      <div className="waveWrapperInner bgMiddle">
        <div className="wave waveMiddle" style={{ backgroundImage: WAVE_MID }} />
      </div>
      <div className="waveWrapperInner bgBottom">
        <div className="wave waveBottom" style={{ backgroundImage: WAVE_BOT }} />
      </div>
    </div>
  )
}
