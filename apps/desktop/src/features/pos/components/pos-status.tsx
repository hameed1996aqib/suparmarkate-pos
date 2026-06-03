import { Barcode } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

type PosStatusProps = {
  status: string;
};

export function PosStatus({ status }: PosStatusProps) {
  return (
    <Card className="border-border bg-card">
      <CardContent className="flex items-center gap-3 p-4 text-primary">
        <Barcode className="h-5 w-5" />
        <span className="font-semibold">{status}</span>
      </CardContent>
    </Card>
  );
}
