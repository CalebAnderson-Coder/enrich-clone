'use client';

import { useState } from 'react';
import { leadsMockData, Lead } from '../data/leadsMock';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';

export default function LeadsDashboard() {
  const [activeTab, setActiveTab] = useState('Todos');

  const getScoreBadge = (score: string) => {
    switch (score) {
      case 'Caliente':
        return <Badge className="bg-red-500 hover:bg-red-600">Caliente</Badge>;
      case 'Tibio':
        return <Badge className="bg-amber-500 hover:bg-amber-600">Tibio</Badge>;
      case 'Frío':
        return <Badge className="bg-blue-500 hover:bg-blue-600">Frío</Badge>;
      case 'Radar':
        return <Badge className="bg-slate-500 hover:bg-slate-600">En Radar</Badge>;
      default:
        return <Badge variant="secondary">{score}</Badge>;
    }
  };

  const filteredLeads = leadsMockData.filter((lead) => {
    if (activeTab === 'Todos') return true;
    if (activeTab === 'Radar') return lead.score === 'Radar';
    return lead.score === activeTab;
  });

  return (
    <div className="flex flex-col gap-6">
      <Tabs defaultValue="Todos" value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-4 lg:w-[500px]">
          <TabsTrigger value="Todos">Todos</TabsTrigger>
          <TabsTrigger value="Caliente">Caliente</TabsTrigger>
          <TabsTrigger value="Tibio">Tibio</TabsTrigger>
          <TabsTrigger value="Radar">Radar</TabsTrigger>
        </TabsList>
        <TabsContent value={activeTab} className="mt-6">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredLeads.map((lead) => (
              <Card key={lead.id} className="flex flex-col">
                <CardHeader className="pb-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <CardTitle className="text-lg">{lead.name}</CardTitle>
                      <CardDescription className="font-medium text-primary mt-1">
                        {lead.company}
                      </CardDescription>
                    </div>
                    {getScoreBadge(lead.score)}
                  </div>
                </CardHeader>
                <CardContent className="flex-1 pb-3">
                  <div className="flex flex-col gap-2 text-sm text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <Icons.chat className="h-4 w-4" />
                      <span>{lead.email}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Icons.share className="h-4 w-4" />
                      <span>{lead.source}</span>
                    </div>
                    <div className="mt-2 bg-muted p-3 rounded-md text-foreground">
                      <p className="text-xs font-semibold mb-1 text-muted-foreground">Contexto de la IA:</p>
                      <p className="text-sm">{lead.context}</p>
                    </div>
                  </div>
                </CardContent>
                <CardFooter className="pt-3 border-t">
                  <div className="flex justify-between w-full">
                    <Button variant="outline" size="sm" className="w-[48%]">
                      <Icons.profile className="h-4 w-4 mr-2" />
                      Ver Perfil
                    </Button>
                    <Button size="sm" className="w-[48%] bg-primary">
                      <Icons.chat className="h-4 w-4 mr-2" />
                      Contactar
                    </Button>
                  </div>
                </CardFooter>
              </Card>
            ))}
            
            {filteredLeads.length === 0 && (
              <div className="col-span-full py-12 flex flex-col items-center justify-center text-center border rounded-lg border-dashed">
                <Icons.search className="h-10 w-10 text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium">No se encontraron leads</h3>
                <p className="text-sm text-muted-foreground mt-1">No hay leads en la categoría seleccionada.</p>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
