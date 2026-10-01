import { Redirect } from "expo-router";

/**
 * Legacy route. v3 folds Edit Profile into Profile: the avatar (the only
 * editable account field, `useProfilePhoto`), the read-only details and
 * Change password all live there now; old links land on Profile.
 */
export default function EditProfileRedirect() {
  return <Redirect href="/profile" />;
}
