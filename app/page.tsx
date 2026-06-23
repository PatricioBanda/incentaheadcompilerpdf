import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PrototypeDashboard } from '@/components/smartcomprovante/prototype-dashboard'
import SmartComprovanteOverview from '@/components/smartcomprovante/dashboard'

export default function HomePage() {
  return (
    <Tabs defaultValue="smartcomprovante" className="w-full">
      <TabsList className="m-4">
        <TabsTrigger value="smartcomprovante">SmartComprovante</TabsTrigger>
        <TabsTrigger value="pdftools">PDF Tools</TabsTrigger>
      </TabsList>
      
      <TabsContent value="smartcomprovante" className="m-0">
        <SmartComprovanteOverview />
      </TabsContent>
      
      <TabsContent value="pdftools" className="m-0">
        <PrototypeDashboard />
      </TabsContent>
    </Tabs>
  )
}
