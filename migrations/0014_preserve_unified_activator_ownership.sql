CREATE TRIGGER activate_ri_claimed_email_matches_owner
BEFORE UPDATE OF email_normalized ON activate_ri_activators
FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM auth_activator_memberships membership
  LEFT JOIN auth_user_emails primary_email
    ON primary_email.user_id = membership.user_id
    AND primary_email.is_primary = 1
    AND primary_email.verified_at IS NOT NULL
  WHERE membership.event_id = OLD.event_id
    AND membership.activator_id = OLD.id
    AND membership.revoked_at IS NULL
    AND (
      primary_email.email_normalized IS NULL
      OR primary_email.email_normalized <> NEW.email_normalized
    )
)
BEGIN
  SELECT RAISE(ABORT, 'claimed activator email must match verified primary email');
END;
