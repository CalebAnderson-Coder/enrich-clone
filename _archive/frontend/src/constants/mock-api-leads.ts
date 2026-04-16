// //////////////////////////////////////////////////////////////////////////////
// 🛑 Nothing in here has anything to do with Nextjs, it's just a fake database
// //////////////////////////////////////////////////////////////////////////////

import { faker } from '@faker-js/faker';
import { matchSorter } from 'match-sorter';
import type { Lead } from '../features/leads/api/types';

export const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Mock lead data store
export const fakeLeads = {
  records: [] as Lead[],

  initialize() {
    const sampleLeads: Lead[] = [];
    function generateRandomLeadData(id: string): Lead {
      const tiers = ['A', 'B', 'C'] as const;
      const statuses = ['uncontacted', 'contacted', 'qualified', 'customer', 'unqualified'] as const;

      return {
        id,
        business_name: faker.company.name(),
        industry: faker.commerce.department(),
        website: faker.internet.url(),
        email: faker.internet.email(),
        phone: faker.phone.number({ style: 'national' }),
        lead_tier: faker.helpers.arrayElement(tiers),
        outreach_status: faker.helpers.arrayElement(statuses),
        created_at: faker.date.between({ from: '2022-01-01', to: '2023-12-31' }).toISOString()
      };
    }

    for (let i = 1; i <= 50; i++) {
      sampleLeads.push(generateRandomLeadData(faker.string.uuid()));
    }

    this.records = sampleLeads;
  },

  async getAll({ search }: { search?: string }) {
    let leads = [...this.records];

    if (search) {
      leads = matchSorter(leads, search, {
        keys: ['business_name', 'email', 'industry']
      });
    }

    return leads;
  },

  async createLead(data: Omit<Lead, 'id' | 'created_at'>) {
    await delay(800);

    const newLead: Lead = {
      ...data,
      id: faker.string.uuid(),
      created_at: new Date().toISOString()
    };

    this.records.push(newLead);

    return {
      success: true,
      message: 'Lead created successfully',
      lead: newLead
    };
  },

  async updateLead(id: string, data: Partial<Omit<Lead, 'id' | 'created_at'>>) {
    await delay(800);

    const index = this.records.findIndex((lead) => lead.id === id);

    if (index === -1) {
      return { success: false, message: `Lead with ID ${id} not found` };
    }

    this.records[index] = {
      ...this.records[index],
      ...data
    };

    return {
      success: true,
      message: 'Lead updated successfully',
      lead: this.records[index]
    };
  },

  async deleteLead(id: string) {
    await delay(800);

    const index = this.records.findIndex((lead) => lead.id === id);

    if (index === -1) {
      return { success: false, message: `Lead with ID ${id} not found` };
    }

    this.records.splice(index, 1);

    return {
      success: true,
      message: 'Lead deleted successfully'
    };
  },

  async getLeads({
    page = 1,
    limit = 10,
    status,
    search,
    sort
  }: {
    page?: number;
    limit?: number;
    status?: string;
    search?: string;
    sort?: string;
  }) {
    await delay(800);
    
    let allLeads = await this.getAll({ search });

    if (status) {
      const statuses = status.split(',');
      allLeads = allLeads.filter((l) => statuses.includes(l.outreach_status));
    }

    // Sorting
    if (sort) {
      try {
        const sortItems = JSON.parse(sort) as {
          id: string;
          desc: boolean;
        }[];
        if (sortItems.length > 0) {
          const { id, desc } = sortItems[0];
          allLeads.sort((a, b) => {
            const aVal = (a as Record<string, unknown>)[id];
            const bVal = (b as Record<string, unknown>)[id];
            
            if (typeof aVal === 'number' && typeof bVal === 'number') {
              return desc ? bVal - aVal : aVal - bVal;
            }
            const aStr = String(aVal ?? '').toLowerCase();
            const bStr = String(bVal ?? '').toLowerCase();
            return desc ? bStr.localeCompare(aStr) : aStr.localeCompare(bStr);
          });
        }
      } catch {
        // Invalid sort param — ignore
      }
    }

    const totalLeads = allLeads.length;

    const offset = (page - 1) * limit;
    const paginatedLeads = allLeads.slice(offset, offset + limit);

    return {
      success: true,
      time: new Date().toISOString(),
      message: 'Sample data for testing and learning purposes',
      total_leads: totalLeads,
      offset,
      limit,
      data: paginatedLeads
    };
  }
};

fakeLeads.initialize();
