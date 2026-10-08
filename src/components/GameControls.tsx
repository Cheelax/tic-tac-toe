import type { Settings } from "../match";

interface Props { settings: Settings; onChange: (settings: Partial<Settings>) => void }

export function GameControls({ settings, onChange }: Props) {
  return (
    <fieldset className="game-controls">
      <legend>Set up your game</legend>
      <label>Opponent
        <select data-testid="mode" value={settings.mode} onChange={(e) => onChange({ mode: e.target.value as Settings["mode"] })}>
          <option value="pvp">A friend</option><option value="cpu">Computer</option>
        </select>
      </label>
      <label>Difficulty
        <select data-testid="difficulty" value={settings.difficulty} onChange={(e) => onChange({ difficulty: e.target.value as Settings["difficulty"] })}>
          <option value="easy">Easy</option><option value="hard">Hard</option>
        </select>
      </label>
      <label>First move
        <select data-testid="first" value={settings.first} onChange={(e) => onChange({ first: e.target.value as Settings["first"] })}>
          <option value="human">You</option><option value="computer">Computer</option>
        </select>
      </label>
      <p className="settings-hint">{settings.mode === "cpu"
        ? `${settings.difficulty === "easy" ? "Easy explores. A chance to win." : "Hard plays to win. Can you hold a draw?"} You play ${settings.first === "human" ? "X" : "O"}.`
        : "Pass the turn to a friend. X starts; computer settings apply only against the computer."}</p>
    </fieldset>
  );
}
