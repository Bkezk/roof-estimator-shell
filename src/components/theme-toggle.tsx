/**
 * The light / dark toggle (owner, Oct 2: "a toggle to the right of the Collapse menu button with
 * a sun and moon symbol"). The icon is the mode you switch TO: a moon in light mode, a sun in
 * dark mode; the aria-label and tooltip say the same ("Switch to dark mode").
 *
 * - `sidebar`: a small ghost icon button beside Collapse menu in the open sidebar.
 * - `sidebar-collapsed`: an icon-only sidebar menu button (its own row) in the icon-only sidebar,
 *   with the sidebar's own tooltip, like every other collapsed item.
 * - `account`: an outlined button with the words, for the Account page.
 */
import { Moon, Sun } from "lucide-react";

import { useTheme } from "@/lib/theme-store";
import { toggleLabel } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import { SidebarMenuButton } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function ThemeToggle({ variant }: { variant: "sidebar" | "sidebar-collapsed" | "account" }) {
  const { resolved, toggle } = useTheme();
  const label = toggleLabel(resolved);
  const Icon = resolved === "dark" ? Sun : Moon;

  if (variant === "sidebar-collapsed")
    return (
      <SidebarMenuButton
        onClick={toggle}
        tooltip={label}
        aria-label={label}
        data-theme-toggle={resolved}
      >
        <Icon className="h-4 w-4" />
      </SidebarMenuButton>
    );

  if (variant === "account")
    return (
      <Button
        type="button"
        variant="outline"
        onClick={toggle}
        aria-label={label}
        data-theme-toggle={resolved}
      >
        <Icon className="mr-2 h-4 w-4" />
        {label}
      </Button>
    );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={toggle}
          aria-label={label}
          data-theme-toggle={resolved}
          className="h-8 w-8 shrink-0 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <Icon className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}
