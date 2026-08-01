"use client";

import React, { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { contactApi } from "@/services/apiClient";
import { ArrowLeft, Mail, Phone, Linkedin, Users } from "lucide-react";
import Link from "next/link";

export default function ContactDetailPage() {
  const params = useParams();
  const contactId = params?.id as string;
  const [contact, setContact] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchContact = async () => {
      try {
        const contacts = await contactApi.getContacts();
        const found = contacts.find((c) => c.id === contactId) || contacts[0];
        setContact(found);
      } catch (err) {
        console.error("Failed to load contact detail:", err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchContact();
  }, [contactId]);

  if (isLoading || !contact) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
          <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto animate-spin">
            <Users className="w-6 h-6 animate-pulse" />
          </div>
          <h2 className="text-lg font-bold text-foreground">Loading Contact Details...</h2>
        </div>
      </DashboardLayout>
    );
  }

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
