/**
 * Biblioteca de CRONs prontas — definidas em campos canônicos (dia da semana Unix: 0 = domingo)
 * e montadas no formato escolhido pelo usuário via assemble().
 */
export const PRESET_CATEGORIES = [
  { id: 'all', label: 'Todas' },
  { id: 'freq', label: 'Frequentes' },
  { id: 'daily', label: 'Diárias' },
  { id: 'weekly', label: 'Semanais' },
  { id: 'monthly', label: 'Mensais' },
  { id: 'business', label: 'Dias úteis' },
  { id: 'interval', label: 'Intervalos' },
]

export const PRESETS = [
  { id: 'every-minute', name: 'A cada minuto', category: 'freq', c: { minute: '*' } },
  { id: 'every-5', name: 'A cada 5 minutos', category: 'freq', c: { minute: '*/5' } },
  { id: 'every-15', name: 'A cada 15 minutos', category: 'freq', c: { minute: '*/15' } },
  { id: 'every-30', name: 'A cada 30 minutos', category: 'freq', c: { minute: '*/30' } },
  { id: 'hourly', name: 'A cada hora', category: 'freq', c: { minute: '0' } },
  { id: 'midnight', name: 'Todos os dias à meia-noite', category: 'daily', c: { minute: '0', hour: '0' } },
  { id: 'eight', name: 'Todos os dias às 08:00', category: 'daily', c: { minute: '0', hour: '8' } },
  { id: 'twice', name: 'Duas vezes ao dia (08:00 e 20:00)', category: 'daily', c: { minute: '0', hour: '8,20' } },
  { id: 'noon', name: 'Todos os dias ao meio-dia', category: 'daily', c: { minute: '0', hour: '12' } },
  { id: 'monday', name: 'Toda segunda-feira às 09:00', category: 'weekly', c: { minute: '0', hour: '9', dow: '1' } },
  { id: 'friday', name: 'Toda sexta-feira às 18:00', category: 'weekly', c: { minute: '0', hour: '18', dow: '5' } },
  { id: 'weekend', name: 'Fins de semana às 10:00', category: 'weekly', c: { minute: '0', hour: '10', dow: '0,6' } },
  { id: 'first-day', name: 'Todo dia 1º do mês', category: 'monthly', c: { minute: '0', hour: '0', dom: '1' } },
  { id: 'mid-month', name: 'Dias 1 e 15 do mês', category: 'monthly', c: { minute: '0', hour: '6', dom: '1,15' } },
  { id: 'quarterly', name: 'Trimestral (1º dia)', category: 'monthly', c: { minute: '0', hour: '0', dom: '1', month: '1/3' } },
  { id: 'yearly', name: 'Anual (1º de janeiro)', category: 'monthly', c: { minute: '0', hour: '0', dom: '1', month: '1' } },
  { id: 'business-9', name: 'Todo dia útil às 09:00', category: 'business', c: { minute: '0', hour: '9', dow: '1-5' } },
  { id: 'business-930', name: 'Dias úteis às 09:30', category: 'business', c: { minute: '30', hour: '9', dow: '1-5' } },
  { id: 'business-hours', name: 'A cada 15 min em horário comercial', category: 'business', c: { minute: '*/15', hour: '8-17', dow: '1-5' } },
  { id: 'every-2h', name: 'A cada 2 horas', category: 'interval', c: { minute: '0', hour: '*/2' } },
  { id: 'every-6h', name: 'A cada 6 horas', category: 'interval', c: { minute: '0', hour: '*/6' } },
  { id: 'every-2h-business', name: 'A cada 2 horas, de segunda a sexta', category: 'interval', c: { minute: '0', hour: '*/2', dow: '1-5' } },
  { id: 'every-2d', name: 'A cada 2 dias', category: 'interval', c: { minute: '0', hour: '0', dom: '*/2' } },
  { id: 'every-3d', name: 'A cada 3 dias às 03:00', category: 'interval', c: { minute: '0', hour: '3', dom: '*/3' } },
]
