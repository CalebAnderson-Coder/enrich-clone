'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Icons } from '@/components/icons';
import { useMutation } from '@tanstack/react-query';
import { prospectLeadsMutation } from '../api/mutations';
import { toast } from 'sonner';

export function ProspectModalTrigger() {
  const [open, setOpen] = useState(false);
  const [metro, setMetro] = useState('');
  const [niche, setNiche] = useState('');
  const [limit, setLimit] = useState(20);
  const [autoEnrich, setAutoEnrich] = useState(false);

  const prospectMutation = useMutation({
    ...prospectLeadsMutation,
    onSuccess: (data) => {
      toast.success(data.message || 'Prospecting started!');
      setOpen(false);
    },
    onError: (err) => {
      toast.error('Failed to start prospecting');
      console.error(err);
    }
  });

  const handleProspect = () => {
    if (!metro || !niche) {
      toast.error('Please fill in metro and niche');
      return;
    }
    prospectMutation.mutate({ metro, niche, limit, autoEnrich });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="default" className="bg-blue-600 hover:bg-blue-700 text-white ml-2">
          <Icons.search className="mr-2 h-4 w-4" /> 
          Prospectar
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Iniciar Cacería (Prospectar)</DialogTitle>
          <DialogDescription>
            Busca nuevos leads en Google Maps usando Apify.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="metro" className="text-right">
              Metro (Ciudad)
            </Label>
            <Input
              id="metro"
              placeholder="Ej: Austin, TX"
              value={metro}
              onChange={(e) => setMetro(e.target.value)}
              className="col-span-3"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="niche" className="text-right">
              Industria
            </Label>
            <Input
              id="niche"
              placeholder="Ej: Roofing"
              value={niche}
              onChange={(e) => setNiche(e.target.value)}
              className="col-span-3"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="limit" className="text-right">
              Límite
            </Label>
            <Input
              id="limit"
              type="number"
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="col-span-3"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4 mt-2 p-3 bg-secondary/30 rounded-md border border-border">
            <div className="col-span-3">
              <Label className="text-base font-semibold">Auto-Enrich Flow</Label>
              <p className="text-xs text-muted-foreground mt-1">
                Enriquece automáticamente los leads usando los agentes (Francotirador & Angela) en segundo plano.
              </p>
            </div>
            <div className="col-span-1 flex justify-end">
              <Switch
                checked={autoEnrich}
                onCheckedChange={setAutoEnrich}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button type="button" onClick={handleProspect} disabled={prospectMutation.isPending} className="bg-blue-600 hover:bg-blue-700 text-white">
            {prospectMutation.isPending ? <Icons.spinner className="animate-spin mr-2 h-4 w-4" /> : <Icons.search className="mr-2 h-4 w-4" />}
            Iniciar Prospección
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
