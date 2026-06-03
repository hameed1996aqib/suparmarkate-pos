import { useEffect, useState } from "react";

import { API_BASE_URL } from "@/lib/api-config";

type Currency = {
  code: string;
  isBase?: boolean;
};

export function useBaseCurrencyCode(apiBaseUrl = API_BASE_URL) {
  const [code, setCode] = useState("AFN");

  useEffect(() => {
    let active = true;

    fetch(`${apiBaseUrl}/api/currencies`)
      .then((response) => response.json())
      .then((json) => {
        if (!active) return;
        const currencies = (json?.data || []) as Currency[];
        setCode(currencies.find((currency) => currency.isBase)?.code || "AFN");
      })
      .catch(() => {
        if (active) setCode("AFN");
      });

    return () => {
      active = false;
    };
  }, [apiBaseUrl]);

  return code;
}

export function formatMoney(value: unknown, currencyCode: string) {
  return `${new Intl.NumberFormat("en-US").format(Number(value || 0))} ${currencyCode}`;
}
