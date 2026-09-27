const STORAGE_KEY = "tribalScholarApplications";

const STATUSES = [
  "Submitted",
  "Under Review",
  "Deficient",
  "Approved (Demo)"
];

function getApplications() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveApplications(applications) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(applications));
}

function showPage(pageId) {
  document.querySelectorAll(".page").forEach(page => {
    page.classList.remove("active");
  });

  document.getElementById(pageId).classList.add("active");

  if (pageId === "admin") renderAdmin();
  if (pageId === "home") updateHomeStats();

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function chooseScheme(scheme) {
  document.getElementById("scheme").value = scheme;
  showPage("apply");
  updateSchemeFields();
}

function updateSchemeFields() {
  const scheme = document.getElementById("scheme").value;
  const offerField = document.getElementById("offerLetterField");
  const offerInput = document.getElementById("offerLetter");

  const isNOS = scheme === "NOS";

  offerField.classList.toggle("hidden", !isNOS);
  offerInput.required = isNOS;

  if (!isNOS) offerInput.value = "";
}

document.getElementById("scheme").addEventListener(
  "change",
  updateSchemeFields
);

function runPreCheck(data) {
  const issues = [];

  if (!data.name.trim()) issues.push("Student name is missing.");
  if (!data.email.trim()) issues.push("Email is missing.");
  if (!data.phone.trim()) issues.push("Mobile number is missing.");

  if (!data.stCertificate) {
    issues.push("ST certificate is missing.");
  }

  if (!data.marksheet) {
    issues.push("Academic record is missing.");
  }

  if (!data.incomeCertificate) {
    issues.push("Income certificate is missing.");
  }

  if (data.scheme === "NOS" && !data.offerLetter) {
    issues.push("Offer letter is missing for this demo workflow.");
  }

  if (data.income < 0 || !Number.isFinite(data.income)) {
    issues.push("Income value is invalid.");
  }

  if (
    data.marks < 0 ||
    data.marks > 100 ||
    !Number.isFinite(data.marks)
  ) {
    issues.push("Marks must be between 0 and 100.");
  }

  return issues;
}

function showFormMessage(message, type) {
  const box = document.getElementById("formMessage");

  box.textContent = message;
  box.className = `message ${type}`;
}

document.getElementById("applicationForm").addEventListener(
  "submit",
  function (event) {
    event.preventDefault();

    const scheme = document.getElementById("scheme").value;

    const data = {
      name: document.getElementById("fullName").value.trim(),
      email: document.getElementById("email").value.trim(),
      phone: document.getElementById("phone").value.trim(),
      scheme,
      education: document.getElementById("education").value,
      income: Number(document.getElementById("income").value),
      marks: Number(document.getElementById("marks").value),
      institution: document.getElementById("institution").value.trim(),

      stCertificate:
        document.getElementById("stCertificate").files[0]?.name || "",

      marksheet:
        document.getElementById("marksheet").files[0]?.name || "",

      incomeCertificate:
        document.getElementById("incomeCertificate").files[0]?.name || "",

      offerLetter:
        document.getElementById("offerLetter").files[0]?.name || ""
    };

    const issues = runPreCheck(data);

    const applications = getApplications();

    const application = {
      ...data,
      id: "TS26" + Date.now().toString().slice(-6),
      submittedAt: new Date().toLocaleString(),
      status: issues.length ? "Deficient" : "Submitted",
      issues,
      reviewNote: "",
      preCheck: issues.length ? "Issues detected" : "Basic checks passed"
    };

    applications.unshift(application);
    saveApplications(applications);

    showFormMessage(
      `Application saved! Your Application ID is ${application.id}. ` +
      `Pre-check: ${application.preCheck}. ` +
      `This is a demo check, not official verification.`,
      "success"
    );

    this.reset();
    updateSchemeFields();
    updateHomeStats();
  }
);

function getStatusClass(status) {
  if (status === "Deficient") return "deficient";
  if (status === "Under Review") return "review";
  if (status === "Approved (Demo)") return "approved";
  return "pending";
}

function createStatusBadge(status) {
  return `<span class="status ${getStatusClass(status)}">
    ${escapeHTML(status)}
  </span>`;
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

document.getElementById("trackForm").addEventListener(
  "submit",
  function (event) {
    event.preventDefault();

    const id = document.getElementById("trackingId").value.trim();
    const application = getApplications().find(
      item => item.id.toLowerCase() === id.toLowerCase()
    );

    const result = document.getElementById("trackingResult");

    if (!application) {
      result.innerHTML = `
        <div class="message error">
          No application found. Please check your Application ID.
        </div>
      `;
      document.getElementById("applicationTimeline")
    ?.classList.add("hidden");
      return;
    }

    const issueList = application.issues.length
      ? application.issues.map(issue => `<li>${escapeHTML(issue)}</li>`).join("")
      : "<li>No missing fields detected by the basic demo checks.</li>";

    result.innerHTML = `
      <div class="result-card">
        <h3>Application Details</h3>

        <div class="result-line">
          <span>Application ID</span>
          <strong>${escapeHTML(application.id)}</strong>
        </div>

        <div class="result-line">
          <span>Student</span>
          <strong>${escapeHTML(application.name)}</strong>
        </div>

        <div class="result-line">
          <span>Scheme</span>
          <strong>${escapeHTML(application.scheme)}</strong>
        </div>

        <div class="result-line">
          <span>Status</span>
          ${createStatusBadge(application.status)}
        </div>

        <div class="result-line">
          <span>Submitted</span>
          <strong>${escapeHTML(application.submittedAt)}</strong>
        </div>

        <h3 style="margin-top:20px">Pre-check Findings</h3>
        <ul>${issueList}</ul>

        <p class="muted" style="margin-top:15px">
          ${application.reviewNote
            ? "Officer note: " + escapeHTML(application.reviewNote)
            : "No officer note has been added."}
        </p>
      </div>
    `;
    renderApplicationTimeline(application.status);
  }
);

function renderAdmin() {
  const applications = getApplications();

  document.getElementById("adminTotal").textContent =
    applications.length;

  document.getElementById("adminReview").textContent =
    applications.filter(item => item.status === "Under Review").length;

  document.getElementById("adminDeficient").textContent =
    applications.filter(item => item.status === "Deficient").length;

  document.getElementById("adminApproved").textContent =
    applications.filter(item => item.status === "Approved (Demo)").length;

  const table = document.getElementById("applicationsTable");

  if (!applications.length) {
    table.innerHTML = `
      <tr>
        <td colspan="6" class="empty-state">
          No applications yet. Submit a demo application first.
        </td>
      </tr>
    `;
    return;
  }

  table.innerHTML = applications.map(application => `
    <tr>
      <td><strong>${escapeHTML(application.id)}</strong></td>
      <td>${escapeHTML(application.name)}</td>
      <td>${escapeHTML(application.scheme)}</td>
      <td>${escapeHTML(application.preCheck)}</td>
      <td>${createStatusBadge(application.status)}</td>
      <td>
        <select
          aria-label="Update status for ${escapeHTML(application.id)}"
          onchange="updateStatus('${application.id}', this.value)"
        >
          ${STATUSES.map(status => `
            <option value="${status}"
              ${application.status === status ? "selected" : ""}>
              ${status}
            </option>
          `).join("")}
        </select>
      </td>
    </tr>
  `).join("");
}

function updateStatus(id, status) {
  if (!STATUSES.includes(status)) return;

  const applications = getApplications();
  const application = applications.find(item => item.id === id);

  if (!application) return;

  application.status = status;

  if (status === "Deficient" && application.issues.length === 0) {
    application.reviewNote =
      "Officer review requested. Please check the submitted documents.";
  } else if (status === "Under Review") {
    application.reviewNote = "Application moved to review.";
  } else if (status === "Approved (Demo)") {
    application.reviewNote =
      "Demo status only. This is not an official approval.";
  } else if (status === "Submitted") {
    application.reviewNote = "";
  }

  saveApplications(applications);
  renderAdmin();
  updateHomeStats();
}

function updateHomeStats() {
  const applications = getApplications();

  document.getElementById("homeTotal").textContent =
    applications.length;

  document.getElementById("homePending").textContent =
    applications.filter(item =>
      item.status === "Submitted" ||
      item.status === "Under Review"
    ).length;
}

updateSchemeFields();
updateHomeStats();

// Har clicked button ka highlight maintain karo
document.addEventListener("click", function (event) {
  const button = event.target.closest("button");

  // Agar button par click nahi hua, toh kuch mat karo
  if (!button) return;

  // Pehle sabhi buttons se clicked effect hatao
  document.querySelectorAll("button.clicked").forEach(btn => {
    btn.classList.remove("clicked");
  });

  // Ab clicked button par effect lagao
  button.classList.add("clicked");
});
function checkApplicationReadiness() {
  const checks = [
    {
      id: "fullName",
      label: "Full Name"
    },
    {
      id: "email",
      label: "Email Address"
    },
    {
      id: "phone",
      label: "Mobile Number"
    },
    {
      id: "scheme",
      label: "Scholarship Scheme"
    },
    {
      id: "education",
      label: "Education Level"
    },
    {
      id: "income",
      label: "Annual Family Income"
    },
    {
      id: "marks",
      label: "Percentage / Marks"
    },
    {
      id: "institution",
      label: "Institution / University"
    },
    {
      id: "stCertificate",
      label: "ST Certificate"
    },
    {
      id: "marksheet",
      label: "Marksheets / Academic Record"
    },
    {
      id: "incomeCertificate",
      label: "Income Certificate"
    }
  ];

  const missing = [];

  checks.forEach(function (item) {
    const field = document.getElementById(item.id);

    if (!field) {
      missing.push(item.label);
      return;
    }

    if (field.type === "file") {
      if (!field.files || field.files.length === 0) {
        missing.push(item.label);
      }
    } else if (!field.value.trim()) {
      missing.push(item.label);
    }
  });

  const result = document.getElementById("readinessResult");

  if (missing.length === 0) {
    result.innerHTML = `
      <div class="readiness-success">
        <h3>✓ Application looks complete!</h3>
        <p>
          All required fields and documents appear to be present.
          Please review your information before submitting.
        </p>
      </div>
    `;
  } else {
    result.innerHTML = `
      <div class="readiness-warning">
        <h3>Some information is missing</h3>
        <p>Please complete the following:</p>
        <ul>
          ${missing.map(function (item) {
            return `<li>${item}</li>`;
          }).join("")}
        </ul>
      </div>
    `;
  }

  result.scrollIntoView({
    behavior: "smooth",
    block: "nearest"
  });
}
function renderApplicationTimeline(status) {
  const container = document.getElementById("applicationTimeline");

  if (!container) return;

  container.classList.remove("hidden");

  // Match the status used by the existing officer dashboard
  const normalizedStatus =
    status === "Approved (Demo)" ? "Approved" : status;

  const steps = [
    "Submitted",
    "Under Review",
    "Deficient",
    "Approved"
  ];

  const currentIndex = steps.indexOf(normalizedStatus);

  document.querySelectorAll(".timeline-step").forEach(function (step) {
    const stepStatus = step.dataset.status;
    const stepIndex = steps.indexOf(stepStatus);
    const dot = step.querySelector(".timeline-dot");

    step.classList.remove("completed", "current");

    if (currentIndex !== -1 && stepIndex < currentIndex) {
      step.classList.add("completed");
      dot.textContent = "✓";
    } else if (stepIndex === currentIndex) {
      step.classList.add("completed", "current");
      dot.textContent = "✓";
    } else {
      dot.textContent = stepIndex + 1;
    }
  });
}