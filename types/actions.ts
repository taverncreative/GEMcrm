export interface ActionState {
  success: boolean;
  errors: Record<string, string>;
  message: string | null;
}

/**
 * Feedback submit state. `submittedAt` (ISO) is set on every successful
 * submit so the form can render a per-submit timestamped confirmation and
 * re-run its highlight animation — without it, a second identical submit
 * changes nothing visible on screen.
 */
export interface FeedbackActionState extends ActionState {
  submittedAt?: string;
}

export const INITIAL_ACTION_STATE: ActionState = {
  success: false,
  errors: {},
  message: null,
};
