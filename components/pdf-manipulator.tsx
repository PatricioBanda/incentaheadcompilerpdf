'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Merge, Split, FileOutput, RotateCw, Shuffle, Scissors } from 'lucide-react'
import MergeTool from './pdf-tools/merge-tool'
import SplitTool from './pdf-tools/split-tool'
import ExtractTool from './pdf-tools/extract-tool'
import RotateTool from './pdf-tools/rotate-tool'
import MixTool from './pdf-tools/mix-tool'

export default function PDFManipulator() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>PDF Manipulator - PDFsam Style</CardTitle>
          <CardDescription>
            Ferramentas profissionais para manipular PDFs: Merge, Split, Extract, Rotate, Mix
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="merge" className="w-full">
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="merge" className="flex items-center gap-2">
                <Merge className="h-4 w-4" />
                <span className="hidden sm:inline">Merge</span>
              </TabsTrigger>
              <TabsTrigger value="split" className="flex items-center gap-2">
                <Split className="h-4 w-4" />
                <span className="hidden sm:inline">Split</span>
              </TabsTrigger>
              <TabsTrigger value="extract" className="flex items-center gap-2">
                <FileOutput className="h-4 w-4" />
                <span className="hidden sm:inline">Extract</span>
              </TabsTrigger>
              <TabsTrigger value="rotate" className="flex items-center gap-2">
                <RotateCw className="h-4 w-4" />
                <span className="hidden sm:inline">Rotate</span>
              </TabsTrigger>
              <TabsTrigger value="mix" className="flex items-center gap-2">
                <Shuffle className="h-4 w-4" />
                <span className="hidden sm:inline">Mix</span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="merge" className="mt-6">
              <MergeTool />
            </TabsContent>

            <TabsContent value="split" className="mt-6">
              <SplitTool />
            </TabsContent>

            <TabsContent value="extract" className="mt-6">
              <ExtractTool />
            </TabsContent>

            <TabsContent value="rotate" className="mt-6">
              <RotateTool />
            </TabsContent>

            <TabsContent value="mix" className="mt-6">
              <MixTool />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}
