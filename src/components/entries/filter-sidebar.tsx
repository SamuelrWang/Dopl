"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface FilterSidebarProps {
  useCase: string;
  complexity: string;
  onUseCaseChange: (value: string | null) => void;
  onComplexityChange: (value: string | null) => void;
  onReset: () => void;
}

const useCases = [
  "all",
  "cold_outbound",
  "lead_gen",
  "content_creation",
  "data_pipeline",
  "monitoring",
  "automation",
  "agent_system",
  "dev_tooling",
  "customer_support",
  "research",
  "other",
];

const complexities = ["all", "simple", "moderate", "complex", "advanced"];

export function FilterSidebar({
  useCase,
  complexity,
  onUseCaseChange,
  onComplexityChange,
  onReset,
}: FilterSidebarProps) {
  return (
    <div className="space-y-4 p-4 border rounded-lg">
      <h3 className="font-semibold">Filters</h3>

      <div>
        <Label>Use Case</Label>
        <Select value={useCase} onValueChange={onUseCaseChange}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {useCases.map((uc) => (
              <SelectItem key={uc} value={uc}>
                {uc === "all" ? "All" : uc.replace(/_/g, " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label>Complexity</Label>
        <Select value={complexity} onValueChange={onComplexityChange}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {complexities.map((c) => (
              <SelectItem key={c} value={c}>
                {c === "all" ? "All" : c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Button variant="ghost" size="sm" onClick={onReset} className="w-full">
        Reset Filters
      </Button>
    </div>
  );
}
