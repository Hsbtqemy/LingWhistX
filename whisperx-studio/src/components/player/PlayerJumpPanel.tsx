export type PlayerJumpPanelProps = {
  jumpTimeInput: string;
  onJumpTimeInputChange: (value: string) => void;
  jumpTimeError: string;
  disabled: boolean;
  onCommit: () => void;
};

/**
 * Champ « Aller au temps » du panneau gauche Player (présentationnel).
 */
export function PlayerJumpPanel({
  jumpTimeInput,
  onJumpTimeInputChange,
  jumpTimeError,
  disabled,
  onCommit,
}: PlayerJumpPanelProps) {
  return (
    <div className="player-jump-time">
      <label className="player-jump-time-label small" htmlFor="player-jump-time-input">
        Aller au temps
      </label>
      <div className="player-jump-time-row">
        <input
          id="player-jump-time-input"
          type="text"
          className="player-jump-time-input mono"
          placeholder="42,5 ou 1:02:03"
          value={jumpTimeInput}
          autoComplete="off"
          onChange={(e) => onJumpTimeInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onCommit();
            }
          }}
          disabled={disabled}
        />
        <button type="button" className="ghost small" disabled={disabled} onClick={() => onCommit()}>
          Aller
        </button>
      </div>
      {jumpTimeError ? (
        <p className="small player-jump-time-error" role="alert">
          {jumpTimeError}
        </p>
      ) : null}
    </div>
  );
}
