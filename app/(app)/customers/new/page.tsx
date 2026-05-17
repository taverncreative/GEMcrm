import { AddCustomerForm } from "@/components/customers/add-customer-form";

export default function NewCustomerPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900">Add Customer</h1>
      <div className="mt-6 max-w-lg rounded-xl bg-white p-6 shadow-sm">
        <AddCustomerForm />
      </div>
    </div>
  );
}
