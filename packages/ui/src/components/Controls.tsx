import { useCallback, useEffect, useState } from "react";
import { sendControl } from "../gatewayApi";

export function Controls() {
  // Local view of whether we've paused. The single button and the spacebar both
  // flip between pause and resume off this.
  const [paused, setPaused] = useState(false);

  const toggle = useCallback(() => {
    sendControl(paused ? "resume" : "pause");
    setPaused((p) => !p);
  }, [paused]);

  const start = () => {
    sendControl("start");
    setPaused(false);
  };
  const stop = () => {
    sendControl("stop");
    setPaused(false);
  };

  // Spacebar toggles pause/resume.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat) return;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      // don't hijack space while typing, or when a button is focused (let it click)
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "BUTTON" || el?.isContentEditable) return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  return (
    <div className="controls">
      <button
        type="button"
        className="control-btn"
        onClick={(e) => {
          start();
          e.currentTarget.blur();
        }}
      >
        Start
      </button>
      <button
        type="button"
        className="control-btn control-btn--toggle"
        onClick={(e) => {
          toggle();
          e.currentTarget.blur();
        }}
      >
        {paused ? "Resume" : "Pause"}
      </button>
      <button
        type="button"
        className="control-btn"
        onClick={(e) => {
          stop();
          e.currentTarget.blur();
        }}
      >
        Stop
      </button>
    </div>
  );
}
