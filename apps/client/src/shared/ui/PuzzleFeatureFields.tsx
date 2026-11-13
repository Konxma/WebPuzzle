import type { PuzzleFeatures } from "@web-pazle/shared";

export function PuzzleFeatureFields({ features, onChange }: {
  features: PuzzleFeatures;
  onChange: (features: PuzzleFeatures) => void;
}) {
  return <div className="puzzle-features">
    <label className="puzzle-feature">
      <span>Лотки для деталей</span>
      <input type="checkbox" role="switch" checked={features.trays}
        onChange={event => onChange({ ...features, trays: event.target.checked })}/>
    </label>
  </div>;
}
