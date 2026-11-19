import { redirect } from 'next/navigation';

export default function WorkflowsRedirectPage() {
  redirect('/dashboard/activity');
}
