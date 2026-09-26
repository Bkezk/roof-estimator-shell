/**
 * Admin: who drives each service vehicle (owner, Sep 26 — service design §11). Up to two drivers
 * per vehicle and a person may be on two vehicles. Saving a row closes whoever is no longer
 * listed from today and adds the new names from today (setVehicleDrivers), so the history below
 * shows every change. A driver's "Take from inventory" starts on their vehicle.
 */
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Truck } from "lucide-react";

import { listTechnicians, type TechnicianOption } from "@/lib/auth.functions";
import {
  listVehicleDrivers,
  setVehicleDrivers,
  type InventoryLocation,
  type VehicleDriverRow,
} from "@/lib/inventory.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const NONE = "__none__";
const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
/** "2026-09-26" as a local date (new Date("2026-09-26") is UTC midnight — the day before here). */
const fmtDay = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return y && m && day ? new Date(y, m - 1, day).toLocaleDateString() : d;
};

export function VehicleDriversCard(props: { locations: InventoryLocation[] }) {
  const driversFn = useServerFn(listVehicleDrivers);
  const techsFn = useServerFn(listTechnicians);
  const [historyOpen, setHistoryOpen] = useState(false);
  const currentQ = useQuery({
    queryKey: ["vehicle-drivers", "current"],
    queryFn: () => driversFn({ data: {} }),
  });
  const historyQ = useQuery({
    queryKey: ["vehicle-drivers", "history"],
    queryFn: () => driversFn({ data: { history: true } }),
    enabled: historyOpen,
  });
  const techsQ = useQuery({ queryKey: ["inventory-technicians"], queryFn: () => techsFn() });
  const vehicles = props.locations.filter((l) => l.kind === "vehicle");
  // Technicians first, then everyone else with Service access, by name.
  const techs = useMemo(
    () =>
      [...(techsQ.data ?? [])].sort(
        (a, b) => Number(b.technician) - Number(a.technician) || a.name.localeCompare(b.name),
      ),
    [techsQ.data],
  );
  const current = currentQ.data ?? [];
  const vehicleName = (id: string) => props.locations.find((l) => l.id === id)?.name ?? id;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Truck className="h-4 w-4" /> Vehicles &amp; drivers (admin)
        </CardTitle>
        <CardDescription>
          Up to two drivers per vehicle; a person may drive two. A driver&apos;s &ldquo;Take from
          inventory&rdquo; starts on their vehicle. Changes apply from today and the history is
          kept.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {currentQ.error && (
          <p className="text-sm text-destructive">
            {errText(currentQ.error, "Could not load the drivers")}
          </p>
        )}
        {techsQ.error && (
          <p className="text-sm text-destructive">
            {errText(techsQ.error, "Could not load the technicians")}
          </p>
        )}
        {vehicles.length === 0 ? (
          <p className="text-sm text-muted-foreground">No service vehicle is set up.</p>
        ) : currentQ.isLoading || techsQ.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {vehicles.map((v) => {
              const rows = current.filter((r) => r.location_id === v.id);
              // Remount when the saved drivers change so the selects start from the server.
              const sig = rows
                .map((r) => r.user_id)
                .sort()
                .join(",");
              return <VehicleRow key={`${v.id}|${sig}`} vehicle={v} current={rows} techs={techs} />;
            })}
          </ul>
        )}

        <div>
          <button
            type="button"
            className="text-sm text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => setHistoryOpen((o) => !o)}
          >
            {historyOpen ? "Hide history" : "History"}
          </button>
          {historyOpen &&
            (historyQ.error ? (
              <p className="mt-2 text-sm text-destructive">
                {errText(historyQ.error, "Could not load the history")}
              </p>
            ) : historyQ.isLoading ? (
              <p className="mt-2 text-sm text-muted-foreground">Loading…</p>
            ) : (historyQ.data ?? []).length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No drivers have been set yet.</p>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Vehicle</TableHead>
                      <TableHead>Driver</TableHead>
                      <TableHead>From</TableHead>
                      <TableHead>To</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(historyQ.data ?? []).map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="text-xs">{vehicleName(r.location_id)}</TableCell>
                        <TableCell className="text-xs">{r.user_name}</TableCell>
                        <TableCell className="whitespace-nowrap text-xs">
                          {fmtDay(r.from_date)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs">
                          {r.to_date ? fmtDay(r.to_date) : "now"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ))}
        </div>
      </CardContent>
    </Card>
  );
}

function VehicleRow(props: {
  vehicle: InventoryLocation;
  current: VehicleDriverRow[];
  techs: TechnicianOption[];
}) {
  const qc = useQueryClient();
  const setFn = useServerFn(setVehicleDrivers);
  const saved = props.current.map((r) => r.user_id);
  const [first, setFirst] = useState(saved[0] ?? "");
  const [second, setSecond] = useState(saved[1] ?? "");
  const [saving, setSaving] = useState(false);
  // A current driver who is no longer on the technician list still shows by name.
  const options = [
    ...props.techs,
    ...props.current
      .filter((r) => !props.techs.some((t) => t.id === r.user_id))
      .map((r) => ({ id: r.user_id, name: r.user_name, technician: false })),
  ];
  const chosen = [...new Set([first, second].filter(Boolean))];
  const dirty = chosen.slice().sort().join(",") !== saved.slice().sort().join(",");

  const save = () => {
    setSaving(true);
    void setFn({ data: { location_id: props.vehicle.id, user_ids: chosen } })
      .then(() => {
        toast.success(
          chosen.length
            ? `Drivers saved for ${props.vehicle.name}`
            : `${props.vehicle.name} has no driver now`,
        );
        void qc.invalidateQueries({ queryKey: ["vehicle-drivers"] });
        // The admin may have put themselves on (or off) a vehicle.
        void qc.invalidateQueries({ queryKey: ["inventory-my-defaults"] });
      })
      .catch((e: unknown) => toast.error(errText(e, "Could not save the drivers")))
      .finally(() => setSaving(false));
  };

  const picker = (value: string, onChange: (v: string) => void, other: string, n: number) => (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">Driver {n}</Label>
      <Select value={value || NONE} onValueChange={(v) => onChange(v === NONE ? "" : v)}>
        <SelectTrigger className="h-9 w-[220px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>— nobody —</SelectItem>
          {options.map((t) => (
            <SelectItem key={t.id} value={t.id} disabled={t.id === other}>
              {t.name}
              {t.technician ? "" : " (not a technician)"}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <li className="flex flex-wrap items-end gap-3 px-3 py-3">
      <p className="flex min-w-[140px] items-center gap-2 pb-2 text-sm font-medium">
        <Truck className="h-4 w-4 text-muted-foreground" />
        {props.vehicle.name}
      </p>
      {picker(first, setFirst, second, 1)}
      {picker(second, setSecond, first, 2)}
      <Button size="sm" className="mb-0.5" disabled={!dirty || saving} onClick={save}>
        {saving ? "Saving…" : "Save"}
      </Button>
    </li>
  );
}
