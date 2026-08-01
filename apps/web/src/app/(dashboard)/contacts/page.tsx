"use client";

import React, { useState, useEffect } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { contactApi } from "@/services/apiClient";
import { Search, Mail, Phone, Linkedin, CheckCircle2, Users } from "lucide-react";

export default function ContactsPage() {
  const [contactsList, setContactsList] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    const fetchContacts = async () => {
      try {
        const data = await contactApi.getContacts();
        setContactsList(data);
      } catch (err) {
        console.error("Failed to fetch contacts:", err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchContacts();
  }, []);

  const filteredContacts = contactsList.filter(
    (cnt) =>
      cnt.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      cnt.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      cnt.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      cnt.companyName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <DashboardLayout>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Verified Contact Directory</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Deliverability verified email addresses, direct dial numbers, and LinkedIn handles
          </p>
        </div>
      </div>

      <div className="glass-panel p-4 rounded-xl border border-white/10 flex items-center justify-between">
        <div className="w-full max-w-md">
          <Input
            icon={<Search className="w-4 h-4" />}
            placeholder="Search contact name, title, or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="glass-panel rounded-2xl border border-white/10 overflow-hidden shadow-xl">
        <table className="w-full text-left text-sm">
          <thead className="bg-card/60 text-muted-foreground uppercase text-[11px] font-semibold tracking-wider border-b border-border">
            <tr>
              <th className="py-3.5 px-4">Contact</th>
              <th className="py-3.5 px-4">Company</th>
              <th className="py-3.5 px-4">Email</th>
              <th className="py-3.5 px-4">Phone</th>
              <th className="py-3.5 px-4">Verification</th>
              <th className="py-3.5 px-4">Last Contacted</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {isLoading ? (
              <tr>
                <td colSpan={6} className="py-12 text-center">
                  <div className="max-w-sm mx-auto space-y-3">
                    <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto animate-spin">
                      <Users className="w-5 h-5 animate-pulse" />
                    </div>
                    <h4 className="font-bold text-foreground text-sm">Loading Verified Contacts...</h4>
                  </div>
                </td>
              </tr>
            ) : filteredContacts.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-muted-foreground text-xs">
                  No verified contacts found matching your criteria. Run an AI agent campaign to extract contacts.
                </td>
              </tr>
            ) : (
              filteredContacts.map((cnt) => (
                <tr key={cnt.id} className="hover:bg-card/40 transition-colors">
                  <td className="py-3.5 px-4">
                    <div className="font-semibold text-foreground">{cnt.name}</div>
                    <div className="text-xs text-muted-foreground">{cnt.title}</div>
                  </td>
                  <td className="py-3.5 px-4 text-muted-foreground">{cnt.companyName}</td>
                  <td className="py-3.5 px-4 text-indigo-400 font-mono text-xs">{cnt.email}</td>
                  <td className="py-3.5 px-4 text-muted-foreground text-xs">{cnt.phone}</td>
                  <td className="py-3.5 px-4">
                    <StatusBadge status={cnt.status} />
                  </td>
                  <td className="py-3.5 px-4 text-xs text-muted-foreground">{cnt.lastContacted}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </DashboardLayout>
  );
}
