import { useState } from "react";
import { HardDrive, Radar, Trophy } from "lucide-react";
import { SegmentedControl } from "@/components/ui/Form";
import { CuratedPanel } from "./CuratedPanel";
import { UniversalPanel } from "./UniversalPanel";
import { FilesPanel } from "./FilesPanel";

type Mode = "curated" | "universal" | "files";

export default function DiskCleanerView() {
  const [mode, setMode] = useState<Mode>("curated");

  const tabs = (
    <SegmentedControl
      value={mode}
      onChange={setMode}
      ariaLabel="Disk cleaner mode"
      options={[
        { value: "curated", label: "Curated caches", icon: <HardDrive size={11} /> },
        { value: "universal", label: "Universal scan", icon: <Radar size={11} /> },
        { value: "files", label: "Largest files", icon: <Trophy size={11} /> },
      ]}
    />
  );

  if (mode === "universal") return <UniversalPanel tabs={tabs} />;
  if (mode === "files") return <FilesPanel tabs={tabs} />;
  return <CuratedPanel tabs={tabs} />;
}
