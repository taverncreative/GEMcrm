export interface NavItem {
  label: string;
  href: string;
  icon: string;
}

export interface WidgetProps<T = unknown> {
  data: T | null;
  isLoading: boolean;
  error: string | null;
}
