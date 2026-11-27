/**
 * The colours a new Stage is given, in turn, so neighbouring Stages differ
 * before anybody picks one. Each is a `#rrggbb` the API accepts, from the kit's
 * `DEFAULT_COLOR_PRESETS`, skipping the near-white ones a dot would vanish on.
 */
const STAGE_COLORS = ['#2563eb', '#0d9488', '#ca8a04', '#ea580c', '#9333ea', '#16a34a', '#db2777', '#475569'] as const;

/** The colour of the Stage at `index` (zero-based) in a list being written. */
export function stageColorAt(index: number): string {
  return STAGE_COLORS[index % STAGE_COLORS.length] ?? STAGE_COLORS[0];
}
