/** クリックで直接入力できる数値/時刻フィールド(DAWライクな操作感、スペック §7)。
 *  Enter/blur で onCommit。onCommit が false を返すと元値へ復帰し shake。Esc でキャンセル
 *  (SectionBand のリネーム規約と同じ: Enter確定/Esc取消/blur確定)。 */
import React, { useEffect, useRef, useState } from "react";

let shakeInjected = false;
function ensureShakeStyle(): void {
  if (shakeInjected || typeof document === "undefined") return;
  shakeInjected = true;
  const el = document.createElement("style");
  el.textContent =
    "@keyframes bm-shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-3px)}75%{transform:translateX(3px)}}" +
    ".bm-shake{animation:bm-shake .3s}";
  document.head.appendChild(el);
}

export interface NumericFieldProps {
  value: string;
  onCommit: (text: string) => boolean;
  width?: number;
  ariaLabel?: string;
  title?: string;
}

export function NumericField(props: NumericFieldProps): React.JSX.Element {
  const { value, onCommit, width = 64, ariaLabel, title } = props;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [shake, setShake] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // 編集セッションが「未解決」かを示す全レンダー共有の可変セル。commit/cancel は必ず
  // これを先にfalseへ落としてから setEditing(false) する。理由: Enter/Escでの
  // setEditing(false) が <input> をアンマウントすると、実ブラウザ(フォーカス中要素の
  // 除去で blur が発火する仕様。jsdom では再現しないことを確認済み)では、その古い
  // レンダーの onBlur=commit クロージャがそのまま発火しうる — useState の editing は
  // クロージャ内で凍結されており setEditing 後も古い値を見るため、ガード無しだと
  // Enterの二重コミットや、Esc取消し直後に亡霊blurで再コミットされる実バグになる。
  // ref は全レンダーが同一インスタンスを共有するミュータブルセルなので、古いクロージャ
  // から読んでも「このセッションは既に commit/cancel 済みか」を正しく判定できる。
  const activeRef = useRef(false);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  function begin(): void {
    ensureShakeStyle();
    setDraft(value);
    activeRef.current = true;
    setEditing(true);
  }
  function commit(): void {
    if (!activeRef.current) return;
    activeRef.current = false;
    if (onCommit(draft)) { setEditing(false); }
    else { setEditing(false); setShake(true); window.setTimeout(() => setShake(false), 400); }
  }
  function cancel(): void {
    if (!activeRef.current) return;
    activeRef.current = false;
    setEditing(false);
  }

  if (editing) {
    return (
      <input
        ref={inputRef} aria-label={ariaLabel} value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          else if (e.key === "Escape") { e.preventDefault(); cancel(); }
        }}
        style={{
          width, background: "#0a0c10", color: "#e8ebf0",
          borderWidth: 1, borderStyle: "solid", borderColor: "#3a4250",
          borderRadius: 4, padding: "2px 6px", fontFamily: "inherit",
        }}
      />
    );
  }
  return (
    <span
      role="button" tabIndex={0} aria-label={ariaLabel} title={title}
      onClick={begin}
      onKeyDown={(e) => {
        // role="button" な独自要素なのでキーボード操作(Enter/Space)を明示的に配線する
        // (ネイティブ<button>と違い既定では何も起きないため。T7 HitLanes と同じ規約)。
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); begin(); }
      }}
      className={shake ? "bm-shake" : undefined}
      style={{ display: "inline-block", minWidth: width, cursor: "text", color: "#e8ebf0" }}
    >
      {value}
    </span>
  );
}
