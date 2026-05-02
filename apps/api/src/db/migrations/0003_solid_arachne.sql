CREATE TABLE "employee_invitation_stores" (
	"invitation_id" text NOT NULL,
	"store_id" text NOT NULL,
	CONSTRAINT "employee_invitation_stores_invitation_id_store_id_pk" PRIMARY KEY("invitation_id","store_id")
);
--> statement-breakpoint
CREATE TABLE "store_employee_stores" (
	"store_employee_id" text NOT NULL,
	"store_id" text NOT NULL,
	CONSTRAINT "store_employee_stores_store_employee_id_store_id_pk" PRIMARY KEY("store_employee_id","store_id")
);
--> statement-breakpoint
ALTER TABLE "employee_invitation_stores" ADD CONSTRAINT "employee_invitation_stores_invitation_id_employee_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."employee_invitations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_invitation_stores" ADD CONSTRAINT "employee_invitation_stores_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_employee_stores" ADD CONSTRAINT "store_employee_stores_store_employee_id_store_employees_id_fk" FOREIGN KEY ("store_employee_id") REFERENCES "public"."store_employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_employee_stores" ADD CONSTRAINT "store_employee_stores_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employee_invitation_stores_store_id_idx" ON "employee_invitation_stores" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "store_employee_stores_store_id_idx" ON "store_employee_stores" USING btree ("store_id");