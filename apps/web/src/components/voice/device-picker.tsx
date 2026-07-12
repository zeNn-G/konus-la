import { Button } from "@konus-la/ui/components/button";
import { cn } from "@konus-la/ui/lib/utils";
import { CheckIcon } from "lucide-react";
import { useEffect } from "react";

import { useDeviceStore, type DeviceInfo } from "@/lib/voice/devices";
import { deviceManager } from "@/lib/voice/session";

/**
 * Popover content behind the capsule mic chevron and the deck settings button (#25):
 * input and output lists, selection persisted via the device manager. Where output
 * selection doesn't exist (Safari) the section is silently absent — no explanatory copy.
 */
export function DevicePicker() {
  const inputs = useDeviceStore((s) => s.inputs);
  const outputs = useDeviceStore((s) => s.outputs);
  const micId = useDeviceStore((s) => s.micId);
  const speakerId = useDeviceStore((s) => s.speakerId);
  const outputSupported = useDeviceStore((s) => s.outputSupported);

  // The content mounts on open — re-enumerate so the lists reflect this instant.
  useEffect(() => {
    void deviceManager.refresh();
  }, []);

  return (
    <div className="flex w-72 flex-col gap-2 p-1.5">
      <DeviceSection
        title="Input device"
        devices={inputs}
        fallbackName="Microphone"
        selectedId={micId}
        onSelect={(deviceId) => void deviceManager.setMicPreference(deviceId)}
      />
      {outputSupported && (
        <DeviceSection
          title="Output device"
          devices={outputs}
          fallbackName="Speaker"
          selectedId={speakerId}
          onSelect={(deviceId) => deviceManager.setSpeakerPreference(deviceId)}
        />
      )}
    </div>
  );
}

/** The browser's default/communications pseudo-entries — replaced by our own default row. */
const PSEUDO_DEVICE_IDS = new Set(["default", "communications"]);

function DeviceSection({
  title,
  devices,
  fallbackName,
  selectedId,
  onSelect,
}: {
  title: string;
  devices: DeviceInfo[];
  /** Label stem for devices the browser won't name (no permission yet). */
  fallbackName: string;
  /** The persisted preference; null = system default. */
  selectedId: string | null;
  onSelect: (deviceId: string | null) => void;
}) {
  const concrete = devices.filter((device) => !PSEUDO_DEVICE_IDS.has(device.deviceId));
  const rows: Array<{ id: string | null; label: string }> = [
    { id: null, label: "System default" },
    ...concrete.map((device, index) => ({
      id: device.deviceId,
      label: device.label || `${fallbackName} ${index + 1}`,
    })),
  ];

  return (
    <div className="flex flex-col">
      <span className="px-2 py-1 text-xs font-medium text-muted-foreground">{title}</span>
      {rows.map((row) => {
        const selected = selectedId === row.id;
        return (
          <Button
            key={row.id ?? "system-default"}
            size="sm"
            variant="ghost"
            onClick={() => onSelect(row.id)}
            className={cn("justify-start gap-2 font-normal", selected && "bg-muted")}
          >
            <CheckIcon className={cn("size-3.5 shrink-0", !selected && "invisible")} />
            <span className="truncate">{row.label}</span>
          </Button>
        );
      })}
    </div>
  );
}
