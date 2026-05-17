import { WidgetCard } from "./widget-card";
import { ROUTES } from "@/lib/constants/routes";
import type { JobWithContext } from "@/lib/data/jobs";
import type { Customer } from "@/types/database";
import Link from "next/link";

interface RecentActivityProps {
  recentJobs: JobWithContext[];
  recentCustomers: Customer[];
}

interface ActivityItem {
  id: string;
  description: string;
  href: string;
  time: Date;
}

function timeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "Yesterday";
  return `${diffDays}d ago`;
}

export function RecentActivity({
  recentJobs,
  recentCustomers,
}: RecentActivityProps) {
  const activities: ActivityItem[] = [
    ...recentJobs.map((job) => ({
      id: `job-${job.id}`,
      description: `Job created for ${job.site.customer.name}`,
      href: ROUTES.jobDetail(job.id),
      time: new Date(job.created_at),
    })),
    ...recentCustomers.map((c) => ({
      id: `cust-${c.id}`,
      description: `New customer: ${c.name}`,
      href: ROUTES.customerDetail(c.id),
      time: new Date(c.created_at),
    })),
  ]
    .sort((a, b) => b.time.getTime() - a.time.getTime())
    .slice(0, 8);

  return (
    <WidgetCard title="Recent Activity">
      {activities.length === 0 ? (
        <p className="py-4 text-center text-sm text-gray-400">
          No recent activity.
        </p>
      ) : (
        <ul className="space-y-3">
          {activities.map((activity) => (
            <li
              key={activity.id}
              className="flex items-start justify-between text-sm"
            >
              <Link
                href={activity.href}
                className="text-gray-700 hover:text-gray-900"
              >
                {activity.description}
              </Link>
              <span className="ml-3 shrink-0 text-gray-400">
                {timeAgo(activity.time)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}
