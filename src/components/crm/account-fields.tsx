/**
 * Form pieces shared by the new-customer dialog and the account's Edit form (owner, Sep 30): the
 * Account manager picker, an address block (physical or mailing) and the mailing address with
 * its "Same as physical" switch.
 */
import { useCrmUsers } from "@/lib/use-crm-users";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

/** Radix Select has no empty value; this stands for "no account manager". */
const NONE = "__none__";

/** The account manager picker; "" = unassigned. */
export function AccountManagerSelect(props: {
  id: string;
  value: string;
  onChange: (id: string) => void;
}) {
  const users = useCrmUsers();
  const list = users.data ?? [];
  // A manager who is no longer listed still shows as picked.
  const known = !props.value || list.some((u) => u.id === props.value);
  return (
    <div className="space-y-1">
      <Label htmlFor={props.id}>Account manager</Label>
      <Select
        value={props.value || NONE}
        onValueChange={(v) => props.onChange(v === NONE ? "" : v)}
      >
        <SelectTrigger id={props.id}>
          <SelectValue placeholder={users.isLoading ? "Loading users…" : "Unassigned"} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Unassigned</SelectItem>
          {!known && <SelectItem value={props.value}>(a removed user)</SelectItem>}
          {list.map((u) => (
            <SelectItem key={u.id} value={u.id}>
              {u.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {users.error && (
        <p className="text-xs text-destructive">
          Could not load the users:{" "}
          {users.error instanceof Error ? users.error.message : String(users.error)}
        </p>
      )}
    </div>
  );
}

export interface AddressValue {
  address1: string;
  address2: string;
  city: string;
  state: string;
  zip: string;
}

/** Street, line 2, city / state / zip. `label` names the block for screen readers. */
export function AddressInputs(props: {
  label: string;
  value: AddressValue;
  onChange: (k: keyof AddressValue, v: string) => void;
}) {
  const { label, value: a, onChange } = props;
  return (
    <div className="space-y-2">
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          aria-label={`${label} line 1`}
          placeholder="Address line 1"
          value={a.address1}
          onChange={(e) => onChange("address1", e.target.value)}
        />
        <Input
          aria-label={`${label} line 2`}
          placeholder="Address line 2"
          value={a.address2}
          onChange={(e) => onChange("address2", e.target.value)}
        />
      </div>
      <div className="grid grid-cols-[1fr_4.5rem_6rem] gap-3">
        <Input
          aria-label={`${label} city`}
          placeholder="City"
          value={a.city}
          onChange={(e) => onChange("city", e.target.value)}
        />
        <Input
          aria-label={`${label} state`}
          placeholder="State"
          value={a.state}
          onChange={(e) => onChange("state", e.target.value)}
        />
        <Input
          aria-label={`${label} zip`}
          placeholder="Zip"
          inputMode="numeric"
          value={a.zip}
          onChange={(e) => onChange("zip", e.target.value)}
        />
      </div>
    </div>
  );
}

/** The mailing address: a "Same as physical" switch, and its own fields when that is off. */
export function MailingAddressInputs(props: {
  idPrefix: string;
  same: boolean;
  onSame: (same: boolean) => void;
  value: AddressValue;
  onChange: (k: keyof AddressValue, v: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">Mailing address</p>
        <div className="flex items-center gap-2">
          <Switch
            id={`${props.idPrefix}-mailing-same`}
            checked={props.same}
            onCheckedChange={props.onSame}
          />
          <Label htmlFor={`${props.idPrefix}-mailing-same`} className="font-normal">
            Same as physical
          </Label>
        </div>
      </div>
      {!props.same && (
        <AddressInputs label="Mailing address" value={props.value} onChange={props.onChange} />
      )}
    </div>
  );
}
