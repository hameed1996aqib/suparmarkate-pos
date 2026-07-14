import { Keyboard } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const shortcuts = [
  { key: "F2", label: "فوکس روی بارکود" },
  { key: "Enter", label: "افزودن بارکود" },
  { key: "F4", label: "معلق‌کردن سبد" },
  { key: "F8", label: "چاپ دوباره رسید" },
  { key: "F9", label: "ثبت فروش" },
  { key: "Esc", label: "پاک‌کردن ورودی‌ها" },
];

shortcuts.splice(5, 0, { key: "F10", label: "ثبت بدون چاپ" });

export function PosShortcutsCard() {
  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Keyboard className="h-5 w-5" />
          کلیدهای سریع
        </CardTitle>
        <CardDescription>
          برای سرعت بیشتر فروشنده در صندوق فروش
        </CardDescription>
      </CardHeader>

      <CardContent>
        <div className="grid gap-2 text-sm">
          {shortcuts.map((item) => (
            <div
              key={item.key}
              className="flex items-center justify-between rounded-lg bg-secondary p-2"
            >
              <span className="text-muted-foreground">{item.label}</span>
              <Badge variant="outline" className="font-mono">
                {item.key}
              </Badge>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
