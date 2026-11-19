import { ContentFactoryConsole } from '@/components/marketing/ContentFactoryConsole';

export default async function ContentDetailPage({
  params,
}: {
  params: Promise<{ contentId: string }>;
}) {
  const { contentId } = await params;
  return <ContentFactoryConsole mode="detail" contentId={contentId} />;
}
