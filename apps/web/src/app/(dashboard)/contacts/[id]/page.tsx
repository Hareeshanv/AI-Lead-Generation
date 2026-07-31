"use client";

import React from "react";
import { useParams } from "next/navigation";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { mockContacts } from "@/lib/mockData";
import { ArrowLeft, Mail, Phone, Linkedin } from "lucide-react";
import Link from "next/link";

export default function ContactDetailPage() {
  const params = useParams();
  const contact = mockContacts[0];

  return (
    <DashboardLayout>
      <Link href="/contacts">
        <Button variant="ghost" size="sm">
          <ArrowLeft className="w-4 h-4 mr-1.5" /> Back to Contacts
        </Button>
      </Link>

      <div className="glass-panel p-6 rounded-2xl border border-white/10 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{contact.name}</h1>
          <p className="text-sm text-muted-foreground">{contact.title} • {contact.companyName}</p>
        </div>
        <StatusBadge status={contact.status} />
      </div>

      <Card glass className="space-y-4">
        <h2 className="text-base font-semibold text-foreground">Communication & Direct Details</h2>
        <div className="space-y-2 text-sm">
          <div><strong className="text-muted-foreground">Email:</strong> <span className="text-indigo-400 font-mono">{contact.email}</span></div>
          <div><strong className="text-muted-foreground">Phone:</strong> <span className="text-foreground">{contact.phone}</span></div>
          <div><strong className="text-muted-foreground">LinkedIn:</strong> <a href={contact.linkedin} className="text-primary hover:underline">{contact.linkedin}</a></div>
        </div>
      </Card>
    </DashboardLayout>
  );
}
