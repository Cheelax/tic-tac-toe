import type { Difficulty, First, Mode, Settings as GameSettings } from "../computer";

interface SettingsProps {
  settings: GameSettings;
  onChange: (change: Partial<GameSettings>) => void;
}

/** Who plays: two people or the computer, at which level, and who starts. Any change starts a new game. */
export function Settings({ settings, onChange }: SettingsProps) {
  const cpu = settings.mode === "cpu";
  return (
    <div className="settings" role="group" aria-label="Players">
      <label className="setting">
        <span>Opponent</span>
        <select data-testid="mode" value={settings.mode} onChange={(event) => onChange({ mode: event.target.value as Mode })}>
          <option value="pvp">Two players</option>
          <option value="cpu">Computer</option>
        </select>
      </label>
      <label className="setting" data-off={cpu ? undefined : "true"}>
        <span>Level</span>
        <select
          data-testid="difficulty"
          value={settings.difficulty}
          onChange={(event) => onChange({ difficulty: event.target.value as Difficulty })}
        >
          <option value="easy">Easy</option>
          <option value="hard">Hard</option>
        </select>
      </label>
      <label className="setting" data-off={cpu ? undefined : "true"}>
        <span>First move</span>
        <select data-testid="first" value={settings.first} onChange={(event) => onChange({ first: event.target.value as First })}>
          <option value="human">You</option>
          <option value="computer">Computer</option>
        </select>
      </label>
    </div>
  );
}
