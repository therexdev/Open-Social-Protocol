import { useState } from "react";
import { useVault } from "../../vault/context";
import { Button } from "../../components/ui";
import { MessageRecipientPicker } from "../messages/MessageRecipientPicker";
import { useMessagePeople } from "../messages/useMessagePeople";

/** Reuses verified-address display and friend-first search; selection itself
 * never sends a notification or message. Keys are re-read on chain at publish. */
export function AccountPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
}) {
  const account = useVault((s) => s.account),
    people = useMessagePeople(account, value);
  const [revision, setRevision] = useState(0);
  return (
    <div className="share-picker">
      <MessageRecipientPicker
        key={revision}
        account={account}
        value=""
        onChange={(address) => {
          if (!address) return;
          if (address && address !== account && !value.includes(address))
            onChange([...value, address]);
          setRevision((n) => n + 1);
        }}
        friends={people.friends.filter((a) => !value.includes(a))}
        blocked={people.blocked}
        name={people.name}
        loading={people.loading}
        friendsError={people.error}
        retryFriends={() => void people.refresh()}
        disabled={disabled || value.length >= 50}
      />
      <ul className="share-selected">
        {value.map((address) => (
          <li key={address}>
            <span>
              <strong>{people.name(address)}</strong>
              <small className="mono">{address}</small>
            </span>
            <Button
              variant="ghost"
              disabled={disabled}
              onClick={() => onChange(value.filter((a) => a !== address))}
            >
              Remove
            </Button>
          </li>
        ))}
      </ul>
      <p className="hint">
        {value.length
          ? `${value.length} selected. You also keep access.`
          : "Only you can read this until you add people."}{" "}
        Friends and non-friends can be selected.
      </p>
    </div>
  );
}
