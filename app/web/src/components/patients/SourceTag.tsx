import { SimulatedTag } from "@/components";

export interface SourceTagProps {
  fixtures: boolean;
  /** The fixture file's _source: "sample" for hand-made rows, "<view> @ <ts>" for a saved export. */
  source?: string;
}

/** Says where the rows on screen came from when they are not live Snowflake reads. */
export function SourceTag({ fixtures, source }: SourceTagProps) {
  if (!fixtures) return null;
  const label = !source || source === "sample" ? "Sample data, not from Snowflake" : `Saved export · ${source}`;
  return <SimulatedTag label={label} size="md" />;
}
