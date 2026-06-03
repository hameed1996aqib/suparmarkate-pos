import { Store } from "lucide-react";

import { API_BASE_URL } from "@/lib/api-config";

export type PrintCompany = {
  companyName?: string | null;
  phone?: string | null;
  address?: string | null;
  logoImage?: string | null;
};

function assetUrl(path?: string | null) {
  if (!path) return "";
  return /^https?:\/\//i.test(path) ? path : `${API_BASE_URL}${path}`;
}

export function CompanyPrintHeader({
  company,
  title,
}: {
  company?: PrintCompany | null;
  title: string;
}) {
  return (
    <div className="company-print-header hidden border-b border-black pb-3 print:flex print:items-center print:justify-between print:gap-4">
      <div className="flex items-center gap-3">
        {company?.logoImage ? (
          <img src={assetUrl(company.logoImage)} alt="لوگو" className="size-14 object-contain" />
        ) : (
          <div className="grid size-14 place-items-center border border-black">
            <Store className="size-8" />
          </div>
        )}
        <div>
          <h1 className="text-lg font-bold">{company?.companyName || "Muhaseb"}</h1>
          <p className="text-xs">{company?.phone || ""}</p>
          <p className="text-xs">{company?.address || ""}</p>
        </div>
      </div>
      <div className="text-left">
        <h2 className="text-base font-bold">{title}</h2>
        <p className="text-xs">{new Date().toLocaleString("fa-AF")}</p>
      </div>
    </div>
  );
}
