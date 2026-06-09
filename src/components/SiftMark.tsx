/**
 * Sift brand mark — a forensic funnel / sieve.
 *
 * Ported from the Claude Design prototype (claude-design/src/app.jsx). Pure SVG,
 * no state, so it can render in either a server or client component. Colors are
 * driven by the --text / --accent CSS variables from sift.css.
 */
export function SiftMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <path
        d="M2 3h18l-7 8v7l-4 2v-9L2 3z"
        stroke="var(--text)"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <circle cx="16.5" cy="15.5" r="3.2" stroke="var(--accent)" strokeWidth="1.4" />
      <path
        d="M18.9 17.9 21 20"
        stroke="var(--accent)"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
