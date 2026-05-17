export interface ActionState {
  success: boolean;
  errors: Record<string, string>;
  message: string | null;
}

export const INITIAL_ACTION_STATE: ActionState = {
  success: false,
  errors: {},
  message: null,
};
