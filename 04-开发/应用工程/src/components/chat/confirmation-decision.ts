export type ConfirmationAction = "edit" | "cancel" | "confirm";

export function confirmationDecision(action: ConfirmationAction) {
  return {
    shouldSubmit: action === "confirm",
    shouldCancel: action === "cancel",
    shouldEdit: action === "edit",
  };
}
