import { RegistrationForm } from "@/components/registration-form";
import { getDepartmentSuggestions, getGeofenceConfig, getLowAccuracyThreshold } from "@/lib/config";

// Read env at request time so changing the target never requires a rebuild.
export const dynamic = "force-dynamic";

export default function Home() {
  const geofence = getGeofenceConfig();

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col px-4 py-8 sm:py-14">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Registration</h1>
        <p className="mt-1.5 text-muted">
          Fill in your details and share your location to confirm you are at the designated venue.
        </p>
      </header>

      <RegistrationForm
        geofence={geofence}
        lowAccuracyThreshold={getLowAccuracyThreshold()}
        departments={getDepartmentSuggestions()}
      />

      <footer className="mt-8 text-center text-xs leading-relaxed text-muted">
        Your location is collected only once, when you tap “Get my location”, to verify you are within{" "}
        {geofence.radiusMeters} m of the venue. It is stored with your submission for attendance auditing and is
        not tracked afterwards.
      </footer>
    </main>
  );
}
