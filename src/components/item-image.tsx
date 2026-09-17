import { ImageOff } from "lucide-react";

type Props = {
  zohoItemId: string | null;
  imageUrl: string | null;
  imageDocumentId: string | null;
  alt: string;
  size?: "sm" | "md";
};

export function ItemImage({ zohoItemId, imageUrl, imageDocumentId, alt, size = "md" }: Props) {
  const box = `${size === "sm" ? "size-10" : "size-12"} shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-50`;

  if (!imageUrl || !zohoItemId) {
    return (
      <span className={`${box} grid place-items-center text-slate-300`}>
        <ImageOff className="size-4" />
      </span>
    );
  }

  // Zoho image links need an OAuth token, so they are served through our API route.
  // The document id busts the browser cache when the image changes in Zoho.
  const src = `/api/zoho/items/${zohoItemId}/image?v=${imageDocumentId}`;

  return (
    <a href={src} target="_blank" rel="noreferrer" className={`${box} block transition hover:ring-2 hover:ring-brand-200`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- authenticated same-origin route, not optimisable */}
      <img src={src} alt={alt} loading="lazy" className="size-full object-contain" />
    </a>
  );
}
