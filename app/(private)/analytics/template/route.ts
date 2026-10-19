import { analyticsContext } from '@/lib/analytics-server';
import {rawMetricKeys} from '@/lib/analytics';
export async function GET(){await analyticsContext();return new Response('\uFEFF'+['period_from','period_to',...rawMetricKeys,'source_reference','revenue_evidence','acquisition_evidence'].join(';')+'\r\n',{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="ion-analytics-modelo.csv"','Cache-Control':'private, no-store'}})}
