/* =========================================================
   TRIBALSCHOLAR
   Supabase-powered Scholarship Management System
   ========================================================= */


/* =========================================================
   1. SUPABASE CONFIGURATION
   ========================================================= */

const SUPABASE_URL =
    "https://pzhvbysnrcsumivvvlfx.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
    "sb_publishable_8rAdF0TNelKSQc_MdeKVOA_7EBvDdtt";


if (!window.supabase) {
    throw new Error(
        "Supabase JS library failed to load. Check index.html."
    );
}


if (!SUPABASE_URL.startsWith("https://")) {
    throw new Error("Invalid Supabase URL.");
}


if (!SUPABASE_PUBLISHABLE_KEY.startsWith("sb_publishable_")) {
    throw new Error(
        "Invalid Supabase Publishable Key. Copy the current Publishable key from Supabase."
    );
}


const supabaseClient =
    window.supabase.createClient(
        SUPABASE_URL,
        SUPABASE_PUBLISHABLE_KEY
    );


/* =========================================================
   2. GLOBAL STATE
   ========================================================= */

let currentUser = null;
let currentProfile = null;


/* =========================================================
   3. AUTH UI
   ========================================================= */

function createAuthPanel() {

    if (document.getElementById("authPanel")) {
        return;
    }


    const panel = document.createElement("div");

    panel.id = "authPanel";

    panel.className = "auth-panel";


    panel.innerHTML = `
        <div class="auth-panel-inner">

            <button
                type="button"
                id="closeAuthPanel"
                class="auth-close">
                ×
            </button>


            <div class="auth-brand">

                <span class="eyebrow">
                    TRIBALSCHOLAR ACCESS
                </span>


                <h2 id="authTitle">
                    Student Login
                </h2>


                <p id="authSubtitle">
                    Sign in to access your scholarship dashboard.
                </p>

            </div>


            <form id="authForm">

                <div
                    id="fullNameGroup"
                    class="form-group hidden">

                    <label for="authFullName">
                        Full Name
                    </label>


                    <input
                        type="text"
                        id="authFullName"
                        placeholder="Enter your full name">

                </div>


                <div class="form-group">

                    <label for="authEmail">
                        College Email
                    </label>


                    <input
                        type="email"
                        id="authEmail"
                        placeholder="Enter your college email"
                        required>

                </div>


                <div class="form-group">

                    <label for="authPassword">
                        Password
                    </label>


                    <input
                        type="password"
                        id="authPassword"
                        placeholder="Enter your password"
                        minlength="6"
                        required>

                </div>


                <button
                    type="submit"
                    id="authSubmit"
                    class="primary-btn">
                    Login
                </button>


                <div
                    id="authMessage"
                    class="form-message">
                </div>

            </form>


            <button
                type="button"
                id="authSwitchButton"
                class="text-btn auth-switch">
                Create a Student Account
            </button>

        </div>
    `;


    document.body.appendChild(panel);


    document
        .getElementById("closeAuthPanel")
        ?.addEventListener(
            "click",
            closeAuthPanel
        );


    document
        .getElementById("authForm")
        ?.addEventListener(
            "submit",
            handleAuthSubmit
        );


    document
        .getElementById("authSwitchButton")
        ?.addEventListener(
            "click",
            toggleAuthMode
        );
}


/* =========================================================
   4. AUTH MODE
   ========================================================= */

let authMode = "login";


function openAuthPanel(mode = "login") {

    createAuthPanel();

    authMode = mode;

    updateAuthPanel();


    const panel =
        document.getElementById(
            "authPanel"
        );


    if (panel) {
        panel.classList.add("show");
    }
}


function closeAuthPanel() {

    const panel =
        document.getElementById(
            "authPanel"
        );


    if (panel) {
        panel.classList.remove("show");
    }
}


function toggleAuthMode() {

    authMode =
        authMode === "login"
            ? "signup"
            : "login";

    updateAuthPanel();
}


function updateAuthPanel() {

    const title =
        document.getElementById(
            "authTitle"
        );


    const subtitle =
        document.getElementById(
            "authSubtitle"
        );


    const fullNameGroup =
        document.getElementById(
            "fullNameGroup"
        );


    const submit =
        document.getElementById(
            "authSubmit"
        );


    const switchButton =
        document.getElementById(
            "authSwitchButton"
        );


    const message =
        document.getElementById(
            "authMessage"
        );


    if (
        !title ||
        !subtitle ||
        !fullNameGroup ||
        !submit ||
        !switchButton
    ) {
        return;
    }


    const signup =
        authMode === "signup";


    if (signup) {

        title.textContent =
            "Create Student Account";


        subtitle.textContent =
            "Create your account to apply for scholarships.";


        fullNameGroup.classList.remove(
            "hidden"
        );


        submit.textContent =
            "Create Account";


        switchButton.textContent =
            "Already have an account? Login";

    } else {

        title.textContent =
            "Student Login";


        subtitle.textContent =
            "Sign in to access your scholarship dashboard.";


        fullNameGroup.classList.add(
            "hidden"
        );


        submit.textContent =
            "Login";


        switchButton.textContent =
            "Create a Student Account";
    }


    if (message) {

        message.textContent = "";

        message.className =
            "form-message";
    }
}


/* =========================================================
   5. AUTH SUBMIT
   ========================================================= */

async function handleAuthSubmit(event) {

    event.preventDefault();


    const fullName =
        document
            .getElementById(
                "authFullName"
            )
            ?.value
            .trim();


    const email =
        document
            .getElementById(
                "authEmail"
            )
            ?.value
            .trim();


    const password =
        document
            .getElementById(
                "authPassword"
            )
            ?.value;


    const message =
        document.getElementById(
            "authMessage"
        );


    const submit =
        document.getElementById(
            "authSubmit"
        );


    if (message) {

        message.textContent = "";

        message.className =
            "form-message";
    }


    if (
        authMode === "signup" &&
        !fullName
    ) {

        message.textContent =
            "Please enter your full name.";

        message.classList.add(
            "error"
        );

        return;
    }


    if (
        !email ||
        !password
    ) {

        message.textContent =
            "Please enter email and password.";

        message.classList.add(
            "error"
        );

        return;
    }


    if (password.length < 6) {

        message.textContent =
            "Password must contain at least 6 characters.";

        message.classList.add(
            "error"
        );

        return;
    }


    submit.disabled = true;


    submit.textContent =
        authMode === "signup"
            ? "Creating Account..."
            : "Signing In...";


    try {

        if (authMode === "signup") {

            const {
                data,
                error
            } =
                await supabaseClient.auth.signUp({

                    email: email,

                    password: password,

                    options: {

                        data: {
                            full_name:
                                fullName
                        }
                    }
                });


            if (error) {
                throw error;
            }


            if (data.session) {

                message.textContent =
                    "Account created successfully.";

                message.classList.add(
                    "success"
                );


                await loadCurrentUser();

                closeAuthPanel();

                await showPage(
                    "homePage"
                );

            } else {

                message.textContent =
                    "Account created. Please check your email and verify your account before logging in.";

                message.classList.add(
                    "success"
                );
            }


            return;
        }


        const {
            data,
            error
        } =
            await supabaseClient.auth
                .signInWithPassword({

                    email: email,

                    password: password
                });


        if (error) {
            throw error;
        }


        if (
            !data ||
            !data.session
        ) {

            throw new Error(
                "Login succeeded but no session was created."
            );
        }


        await loadCurrentUser();

        closeAuthPanel();

        await showPage(
            "homePage"
        );


    } catch (error) {

        console.error(
            "Authentication error:",
            error
        );


        message.textContent =
            error?.message ||
            "Authentication failed.";

        message.classList.add(
            "error"
        );


    } finally {

        submit.disabled = false;

        submit.textContent =
            authMode === "signup"
                ? "Create Account"
                : "Login";
    }
}


/* =========================================================
   6. LOAD CURRENT USER
   ========================================================= */

async function loadCurrentUser() {

    try {

        const {
            data,
            error
        } =
            await supabaseClient.auth
                .getSession();


        if (error) {
            throw error;
        }


        const session =
            data?.session;


        if (!session) {

            currentUser = null;

            currentProfile = null;

            updateAuthNavigation();

            return;
        }


        currentUser =
            session.user;


        const {
            data: profile,
            error: profileError
        } =
            await supabaseClient
                .from("profiles")
                .select("*")
                .eq(
                    "id",
                    currentUser.id
                )
                .maybeSingle();


        if (profileError) {

            console.error(
                "Profile loading error:",
                profileError
            );

            currentProfile = null;

        } else {

            currentProfile =
                profile;
        }


        updateAuthNavigation();

        updateApplicationEmail();

        await updateHomeStats();


    } catch (error) {

        console.error(
            "Session error:",
            error
        );


        currentUser = null;

        currentProfile = null;

        updateAuthNavigation();
    }
}


/* =========================================================
   7. AUTH STATE LISTENER
   ========================================================= */

supabaseClient.auth.onAuthStateChange(
    (
        event,
        session
    ) => {

        currentUser =
            session?.user ||
            null;


        setTimeout(
            async () => {

                await loadCurrentUser();

            },
            0
        );
    }
);


/* =========================================================
   8. AUTH NAVIGATION
   ========================================================= */

function updateAuthNavigation() {

    const container =
        document.getElementById(
            "authNavigation"
        );


    if (!container) {
        return;
    }


    if (!currentUser) {

        container.innerHTML = `
            <button
                type="button"
                class="secondary-btn auth-nav-btn"
                id="loginButton">
                Login
            </button>
        `;


        document
            .getElementById(
                "loginButton"
            )
            ?.addEventListener(
                "click",
                () => {

                    openAuthPanel(
                        "login"
                    );

                }
            );


        return;
    }


    const name =
        currentProfile?.full_name ||
        currentUser.email ||
        "User";


    const role =
        currentProfile?.role ||
        "student";


    container.innerHTML = `
        <div class="user-menu">

            <span class="user-name">
                ${escapeHTML(name)}
            </span>

            <span class="user-role">
                ${escapeHTML(role)}
            </span>

            <button
                type="button"
                class="secondary-btn"
                id="logoutButton">
                Sign Out
            </button>

        </div>
    `;


    document
        .getElementById(
            "logoutButton"
        )
        ?.addEventListener(
            "click",
            signOut
        );
}


/* =========================================================
   9. SIGN OUT
   ========================================================= */

async function signOut() {

    const {
        error
    } =
        await supabaseClient.auth
            .signOut();


    if (error) {

        console.error(
            "Sign out error:",
            error
        );

        return;
    }


    currentUser = null;

    currentProfile = null;


    updateAuthNavigation();

    await showPage(
        "homePage"
    );
}


/* =========================================================
   10. REQUIRE LOGIN
   ========================================================= */

async function requireLogin() {

    if (currentUser) {
        return true;
    }


    const {
        data,
        error
    } =
        await supabaseClient.auth
            .getSession();


    if (
        !error &&
        data?.session
    ) {

        await loadCurrentUser();

        return true;
    }


    openAuthPanel(
        "login"
    );


    return false;
}


/* =========================================================
   11. REQUIRE OFFICER
   ========================================================= */

async function requireOfficer() {

    const loggedIn =
        await requireLogin();


    if (!loggedIn) {
        return false;
    }


    if (
        !currentProfile ||
        currentProfile.role !== "officer"
    ) {

        alert(
            "Officer access is required to open this page."
        );


        await showPage(
            "homePage"
        );


        return false;
    }


    return true;
}


/* =========================================================
   12. APPLICATION PRE-CHECK
   ========================================================= */

function runPreCheck() {

    const form =
        document.getElementById(
            "applicationForm"
        );


    if (!form) {
        return [];
    }


    const name =
        String(
            form.elements["name"]?.value ||
            ""
        ).trim();


    const email =
        String(
            form.elements["email"]?.value ||
            ""
        ).trim();


    const phone =
        String(
            form.elements["phone"]?.value ||
            ""
        ).trim();


    const scheme =
        String(
            form.elements["scheme"]?.value ||
            ""
        ).trim();


    const education =
        String(
            form.elements["education"]?.value ||
            ""
        ).trim();


    const institution =
        String(
            form.elements["institution"]?.value ||
            ""
        ).trim();


    const income =
        Number(
            form.elements["income"]?.value
        );


    const marks =
        Number(
            form.elements["marks"]?.value
        );


    const stCertificate =
        getSelectedFile(
            "stCertificate"
        );


    const marksheet =
        getSelectedFile(
            "marksheet"
        );


    const incomeCertificate =
        getSelectedFile(
            "incomeCertificate"
        );


    const offerLetter =
        getSelectedFile(
            "offerLetter"
        );


    const issues = [];


    if (!name) {
        issues.push(
            "Full name is required."
        );
    }


    if (!email) {
        issues.push(
            "Email is required."
        );
    }


    if (!phone) {
        issues.push(
            "Phone number is required."
        );
    }


    if (!scheme) {
        issues.push(
            "Select a scholarship scheme."
        );
    }


    if (!education) {
        issues.push(
            "Education qualification is required."
        );
    }


    if (!institution) {
        issues.push(
            "Institution is required."
        );
    }


    if (!stCertificate) {
        issues.push(
            "ST Certificate is required."
        );
    }


    if (!marksheet) {
        issues.push(
            "Marksheet is required."
        );
    }


    if (!incomeCertificate) {
        issues.push(
            "Income Certificate is required."
        );
    }


    if (
        scheme === "NOS" &&
        !offerLetter
    ) {

        issues.push(
            "Offer Letter is required for NOS."
        );
    }


    if (
        Number.isNaN(income) ||
        income < 0
    ) {

        issues.push(
            "Enter a valid annual income."
        );
    }


    if (
        Number.isNaN(marks) ||
        marks < 0 ||
        marks > 100
    ) {

        issues.push(
            "Marks must be between 0 and 100."
        );
    }


    const readinessBox =
        document.getElementById(
            "readinessBox"
        );


    const readinessMessage =
        document.getElementById(
            "readinessMessage"
        );


    if (!readinessBox || !readinessMessage) {
        return issues;
    }


    if (issues.length === 0) {

        readinessBox.classList.add(
            "ready"
        );


        readinessMessage.textContent =
            "Your application appears ready to submit.";

    } else {

        readinessBox.classList.remove(
            "ready"
        );


        readinessMessage.textContent =
            `${issues.length} item(s) need attention before submission.`;
    }


    return issues;
}


/* =========================================================
   13. APPLICATION EMAIL
   ========================================================= */

function updateApplicationEmail() {

    const emailInput =
        document.getElementById(
            "email"
        );


    if (!emailInput) {
        return;
    }


    if (currentUser?.email) {

        emailInput.value =
            currentUser.email;

        emailInput.readOnly = true;
    }
}


/* =========================================================
   14. FILE HELPERS
   ========================================================= */

function getSelectedFile(elementId) {

    const input =
        document.getElementById(
            elementId
        );


    if (
        !input ||
        !input.files ||
        !input.files.length
    ) {

        return null;
    }


    return input.files[0];
}


/* =========================================================
   15. APPLICATION SUBMISSION
   ========================================================= */

async function submitApplication(event) {

    event.preventDefault();


    const message =
        document.getElementById(
            "applicationMessage"
        );


    const submitButton =
        document.querySelector(
            "#applicationForm button[type='submit']"
        );


    if (!message) {
        return;
    }


    message.textContent = "";

    message.className =
        "form-message";


    const loggedIn =
        await requireLogin();


    if (!loggedIn) {
        return;
    }


    const issues =
        runPreCheck();


    if (issues.length > 0) {

        message.textContent =
            issues[0];

        message.classList.add(
            "error"
        );

        return;
    }


    const form =
        document.getElementById(
            "applicationForm"
        );


    const formData =
        new FormData(form);


    const scheme =
        formData.get("scheme");


    const name =
        String(
            formData.get("name") || ""
        ).trim();


    const email =
        currentUser.email;


    const phone =
        String(
            formData.get("phone") || ""
        ).trim();


    const education =
        String(
            formData.get("education") || ""
        ).trim();


    const income =
        Number(
            formData.get("income")
        );


    const marks =
        Number(
            formData.get("marks")
        );


    const institution =
        String(
            formData.get("institution") || ""
        ).trim();


    if (submitButton) {

        submitButton.disabled = true;

        submitButton.textContent =
            "Submitting...";
    }


    try {

        const {
            data: application,
            error: applicationError
        } =
            await supabaseClient
                .from("applications")
                .insert({

                    user_id:
                        currentUser.id,

                    name,

                    email,

                    phone,

                    scheme,

                    education,

                    income,

                    marks,

                    institution,

                    status:
                        "Submitted",

                    pre_check:
                        true,

                    issues: [],

                    review_note:
                        null

                })
                .select()
                .single();


        if (applicationError) {
            throw applicationError;
        }


        const documents = [

            {
                elementId:
                    "stCertificate",

                type:
                    "ST Certificate"
            },

            {
                elementId:
                    "marksheet",

                type:
                    "Marksheet"
            },

            {
                elementId:
                    "incomeCertificate",

                type:
                    "Income Certificate"
            }

        ];


        if (scheme === "NOS") {

            documents.push({

                elementId:
                    "offerLetter",

                type:
                    "Offer Letter"

            });
        }


        for (
            const document
            of documents
        ) {

            const file =
                getSelectedFile(
                    document.elementId
                );


            if (!file) {
                continue;
            }


            const safeName =
                file.name.replace(
                    /[^a-zA-Z0-9._-]/g,
                    "_"
                );


            const storagePath =
                `${currentUser.id}/${application.id}/${document.type.replace(/\s+/g, "-")}-${Date.now()}-${safeName}`;


            const {
                error: uploadError
            } =
                await supabaseClient
                    .storage
                    .from(
                        "application-documents"
                    )
                    .upload(
                        storagePath,
                        file,
                        {
                            upsert: false
                        }
                    );


            if (uploadError) {
                throw uploadError;
            }


            const {
                error: documentError
            } =
                await supabaseClient
                    .from(
                        "application_documents"
                    )
                    .insert({

                        application_id:
                            application.id,

                        document_type:
                            document.type,

                        original_filename:
                            file.name,

                        storage_path:
                            storagePath

                    });


            if (documentError) {
                throw documentError;
            }
        }


        message.textContent =
            `Application submitted successfully. Your Application ID is ${application.application_id}.`;


        message.classList.add(
            "success"
        );


        form.reset();


        updateApplicationEmail();

        updateOfferLetterRequirement();

        runPreCheck();

        await updateHomeStats();


        setTimeout(
            () => {

                const trackingInput =
                    document.getElementById(
                        "trackingId"
                    );


                if (trackingInput) {

                    trackingInput.value =
                        application.application_id;
                }


                showPage(
                    "trackPage"
                );

            },
            1200
        );


    } catch (error) {

        console.error(
            "Application submission error:",
            error
        );


        message.textContent =
            error?.message ||
            "Unable to submit application.";

        message.classList.add(
            "error"
        );


    } finally {

        if (submitButton) {

            submitButton.disabled =
                false;

            submitButton.textContent =
                "Submit Application";
        }
    }
}


/* =========================================================
   16. TRACK APPLICATION
   ========================================================= */

async function trackApplication(event) {

    event.preventDefault();


    const trackingInput =
        document.getElementById(
            "trackingId"
        );


    const message =
        document.getElementById(
            "trackingMessage"
        );


    const result =
        document.getElementById(
            "trackingResult"
        );


    if (!trackingInput || !message || !result) {
        return;
    }


    const trackingId =
        trackingInput.value.trim();


    message.textContent = "";

    message.className =
        "form-message";


    result.classList.add(
        "hidden"
    );


    const loggedIn =
        await requireLogin();


    if (!loggedIn) {
        return;
    }


    if (!trackingId) {

        message.textContent =
            "Please enter an application ID.";

        message.classList.add(
            "error"
        );

        return;
    }


    try {

        const {
            data: application,
            error
        } =
            await supabaseClient
                .from("applications")
                .select("*")
                .eq(
                    "application_id",
                    trackingId
                )
                .maybeSingle();


        if (error) {
            throw error;
        }


        if (!application) {

            message.textContent =
                "Application not found.";

            message.classList.add(
                "error"
            );

            return;
        }


        renderTrackingResult(
            application
        );


    } catch (error) {

        console.error(
            "Tracking error:",
            error
        );


        message.textContent =
            error?.message ||
            "Unable to find application.";

        message.classList.add(
            "error"
        );
    }
}


/* =========================================================
   17. RENDER TRACKING RESULT
   ========================================================= */

function renderTrackingResult(application) {

    const result =
        document.getElementById(
            "trackingResult"
        );


    if (!result) {
        return;
    }


    result.classList.remove(
        "hidden"
    );


    setText(
        "trackingApplicationId",
        application.application_id
    );


    setText(
        "trackingStatus",
        application.status
    );


    setText(
        "trackingName",
        application.name
    );


    setText(
        "trackingScheme",
        application.scheme
    );


    setText(
        "trackingSubmitted",
        formatDate(
            application.submitted_at
        )
    );


    setText(
        "trackingReviewNote",
        application.review_note ||
        "No review note yet."
    );


    renderTimeline(
        application.status
    );
}


/* =========================================================
   18. TIMELINE
   ========================================================= */

function renderTimeline(currentStatus) {

    const timeline =
        document.getElementById(
            "trackingTimeline"
        );


    if (!timeline) {
        return;
    }


    const statuses = [

        "Submitted",

        "Under Review",

        "Deficient",

        "Approved (Demo)"

    ];


    timeline.innerHTML =
        statuses
            .map(
                status => {

                    const active =
                        status === currentStatus
                            ? "active"
                            : "";


                    const completed =
                        isStatusCompleted(
                            status,
                            currentStatus
                        )
                            ? "completed"
                            : "";


                    return `
                        <div
                            class="timeline-item ${active} ${completed}">

                            <div class="timeline-dot"></div>

                            <div class="timeline-content">

                                <strong>
                                    ${escapeHTML(status)}
                                </strong>

                            </div>

                        </div>
                    `;
                }
            )
            .join("");
}


function isStatusCompleted(
    status,
    currentStatus
) {

    const order = [

        "Submitted",

        "Under Review",

        "Deficient",

        "Approved (Demo)"

    ];


    const currentIndex =
        order.indexOf(
            currentStatus
        );


    const statusIndex =
        order.indexOf(
            status
        );


    if (
        currentIndex === -1 ||
        statusIndex === -1
    ) {
        return false;
    }


    return statusIndex < currentIndex;
}


/* =========================================================
   19. OFFICER PORTAL
   ========================================================= */

async function renderAdmin() {

    const allowed =
        await requireOfficer();


    if (!allowed) {
        return;
    }


    const container =
        document.getElementById(
            "adminApplications"
        );


    const message =
        document.getElementById(
            "adminMessage"
        );


    if (!container) {
        return;
    }


    container.innerHTML =
        "<p>Loading applications...</p>";


    try {

        const {
            data: applications,
            error
        } =
            await supabaseClient
                .from("applications")
                .select("*")
                .order(
                    "submitted_at",
                    {
                        ascending: false
                    }
                );


        if (error) {
            throw error;
        }


        updateAdminStats(
            applications || []
        );


        if (
            !applications ||
            applications.length === 0
        ) {

            container.innerHTML =
                "<p>No applications found.</p>";

            return;
        }


        container.innerHTML =
            applications
                .map(
                    application =>
                        renderAdminApplication(
                            application
                        )
                )
                .join("");


        document
            .querySelectorAll(
                ".admin-status-select"
            )
            .forEach(
                select => {

                    select.addEventListener(
                        "change",
                        handleAdminStatusChange
                    );
                }
            );


    } catch (error) {

        console.error(
            "Admin loading error:",
            error
        );


        container.innerHTML = "";


        if (message) {

            message.textContent =
                error?.message ||
                "Unable to load applications.";

            message.classList.add(
                "error"
            );
        }
    }
}


/* =========================================================
   20. ADMIN APPLICATION CARD
   ========================================================= */

function renderAdminApplication(
    application
) {

    return `
        <article class="admin-application-card">

            <div class="admin-card-header">

                <div>

                    <span class="eyebrow">
                        APPLICATION
                    </span>

                    <h3>
                        ${escapeHTML(
                            application.application_id
                        )}
                    </h3>

                </div>


                <span class="status-badge">
                    ${escapeHTML(
                        application.status
                    )}
                </span>

            </div>


            <div class="admin-details">

                <div>
                    <span>Name</span>

                    <strong>
                        ${escapeHTML(
                            application.name
                        )}
                    </strong>
                </div>


                <div>
                    <span>Email</span>

                    <strong>
                        ${escapeHTML(
                            application.email
                        )}
                    </strong>
                </div>


                <div>
                    <span>Phone</span>

                    <strong>
                        ${escapeHTML(
                            application.phone
                        )}
                    </strong>
                </div>


                <div>
                    <span>Scheme</span>

                    <strong>
                        ${escapeHTML(
                            application.scheme
                        )}
                    </strong>
                </div>


                <div>
                    <span>Education</span>

                    <strong>
                        ${escapeHTML(
                            application.education
                        )}
                    </strong>
                </div>


                <div>
                    <span>Marks</span>

                    <strong>
                        ${escapeHTML(
                            String(
                                application.marks
                            )
                        )}%
                    </strong>
                </div>


                <div>
                    <span>Income</span>

                    <strong>
                        ₹${escapeHTML(
                            String(
                                application.income
                            )
                        )}
                    </strong>
                </div>


                <div>
                    <span>Institution</span>

                    <strong>
                        ${escapeHTML(
                            application.institution
                        )}
                    </strong>
                </div>

            </div>


            <div class="admin-actions">

                <label>
                    Update Status
                </label>


                <select
                    class="admin-status-select"
                    data-application-id="${application.id}">

                    <option
                        value="Submitted"
                        ${
                            application.status === "Submitted"
                                ? "selected"
                                : ""
                        }>
                        Submitted
                    </option>


                    <option
                        value="Under Review"
                        ${
                            application.status === "Under Review"
                                ? "selected"
                                : ""
                        }>
                        Under Review
                    </option>


                    <option
                        value="Deficient"
                        ${
                            application.status === "Deficient"
                                ? "selected"
                                : ""
                        }>
                        Deficient
                    </option>


                    <option
                        value="Approved (Demo)"
                        ${
                            application.status === "Approved (Demo)"
                                ? "selected"
                                : ""
                        }>
                        Approved (Demo)
                    </option>

                </select>

            </div>


            <div class="admin-review-note">

                <label>
                    Review Note
                </label>


                <textarea
                    class="admin-note"
                    data-application-id="${application.id}"
                    placeholder="Add a review note...">${escapeHTML(
                        application.review_note || ""
                    )}</textarea>


                <button
                    type="button"
                    class="secondary-btn save-note-btn"
                    data-application-id="${application.id}">
                    Save Note
                </button>

            </div>

        </article>
    `;
}


/* =========================================================
   21. ADMIN STATUS CHANGE
   ========================================================= */

async function handleAdminStatusChange(
    event
) {

    const applicationId =
        event.target.dataset.applicationId;


    const newStatus =
        event.target.value;


    await updateApplicationStatus(
        applicationId,
        newStatus
    );
}


/* =========================================================
   22. UPDATE APPLICATION STATUS
   ========================================================= */

async function updateApplicationStatus(
    applicationId,
    newStatus
) {

    const allowed =
        await requireOfficer();


    if (!allowed) {
        return;
    }


    try {

        const {
            error
        } =
            await supabaseClient
                .from("applications")
                .update({

                    status:
                        newStatus,

                    updated_at:
                        new Date().toISOString()

                })
                .eq(
                    "id",
                    applicationId
                );


        if (error) {
            throw error;
        }


        await renderAdmin();

        await updateHomeStats();


    } catch (error) {

        console.error(
            "Status update error:",
            error
        );


        alert(
            error?.message ||
            "Unable to update status."
        );
    }
}


/* =========================================================
   23. SAVE REVIEW NOTE
   ========================================================= */

async function saveReviewNote(
    applicationId
) {

    const allowed =
        await requireOfficer();


    if (!allowed) {
        return;
    }


    const textarea =
        document.querySelector(
            `.admin-note[data-application-id="${applicationId}"]`
        );


    if (!textarea) {
        return;
    }


    const note =
        textarea.value.trim();


    try {

        const {
            error
        } =
            await supabaseClient
                .from("applications")
                .update({

                    review_note:
                        note,

                    updated_at:
                        new Date().toISOString()

                })
                .eq(
                    "id",
                    applicationId
                );


        if (error) {
            throw error;
        }


        alert(
            "Review note saved successfully."
        );


        await renderAdmin();


    } catch (error) {

        console.error(
            "Review note error:",
            error
        );


        alert(
            error?.message ||
            "Unable to save review note."
        );
    }
}


/* =========================================================
   24. ADMIN STATS
   ========================================================= */

function updateAdminStats(
    applications
) {

    const total =
        applications.length;


    const submitted =
        applications.filter(
            app =>
                app.status === "Submitted"
        ).length;


    const review =
        applications.filter(
            app =>
                app.status === "Under Review"
        ).length;


    const approved =
        applications.filter(
            app =>
                app.status === "Approved (Demo)"
        ).length;


    setText(
        "adminTotal",
        total
    );


    setText(
        "adminSubmitted",
        submitted
    );


    setText(
        "adminReview",
        review
    );


    setText(
        "adminApproved",
        approved
    );
}


/* =========================================================
   25. HOME STATS
   ========================================================= */

async function updateHomeStats() {

    if (!currentUser) {
        return;
    }


    try {

        const {
            data: applications,
            error
        } =
            await supabaseClient
                .from("applications")
                .select("status");


        if (error) {
            throw error;
        }


        const apps =
            applications || [];


        const total =
            apps.length;


        const submitted =
            apps.filter(
                app =>
                    app.status === "Submitted"
            ).length;


        const review =
            apps.filter(
                app =>
                    app.status === "Under Review"
            ).length;


        const approved =
            apps.filter(
                app =>
                    app.status === "Approved (Demo)"
            ).length;


        setText(
            "statTotal",
            total
        );


        setText(
            "statSubmitted",
            submitted
        );


        setText(
            "statReview",
            review
        );


        setText(
            "statApproved",
            approved
        );


        setText(
            "homeTotalApplications",
            total
        );


        setText(
            "homeApprovedApplications",
            approved
        );


        setText(
            "homePendingApplications",
            review
        );


    } catch (error) {

        console.error(
            "Home stats error:",
            error
        );
    }
}


/* =========================================================
   26. READINESS EVENTS
   ========================================================= */

function setupReadinessListeners() {

    const form =
        document.getElementById(
            "applicationForm"
        );


    if (!form) {
        return;
    }


    form
        .querySelectorAll(
            "input, select"
        )
        .forEach(
            input => {

                input.addEventListener(
                    "input",
                    runPreCheck
                );


                input.addEventListener(
                    "change",
                    runPreCheck
                );
            }
        );


    const scheme =
        document.getElementById(
            "scheme"
        );


    if (scheme) {

        scheme.addEventListener(
            "change",
            () => {

                updateOfferLetterRequirement();

                runPreCheck();
            }
        );
    }
}


/* =========================================================
   27. NAVIGATION
   ========================================================= */

function setupNavigation() {

    document
        .querySelectorAll(
            "[data-page]"
        )
        .forEach(
            button => {

                button.addEventListener(
                    "click",
                    async () => {

                        if (
                            button.dataset.scheme
                        ) {

                            setScheme(
                                button.dataset.scheme
                            );
                        }


                        await showPage(
                            button.dataset.page
                        );
                    }
                );
            }
        );
}


/* =========================================================
   28. ADMIN CLICK HANDLER
   ========================================================= */

document.addEventListener(
    "click",
    event => {

        const button =
            event.target.closest(
                ".save-note-btn"
            );


        if (!button) {
            return;
        }


        const applicationId =
            button.dataset.applicationId;


        saveReviewNote(
            applicationId
        );
    }
);


/* =========================================================
   29. UTILITY FUNCTIONS
   ========================================================= */

function setText(
    elementId,
    value
) {

    const element =
        document.getElementById(
            elementId
        );


    if (element) {

        element.textContent =
            value;
    }
}


function formatDate(
    date
) {

    if (!date) {
        return "—";
    }


    const parsed =
        new Date(date);


    if (
        Number.isNaN(
            parsed.getTime()
        )
    ) {

        return "—";
    }


    return parsed.toLocaleString(
        "en-IN",
        {
            dateStyle: "medium",
            timeStyle: "short"
        }
    );
}


function escapeHTML(
    value
) {

    return String(
        value ?? ""
    )
        .replace(
            /&/g,
            "&amp;"
        )
        .replace(
            /</g,
            "&lt;"
        )
        .replace(
            />/g,
            "&gt;"
        )
        .replace(
            /"/g,
            "&quot;"
        )
        .replace(
            /'/g,
            "&#039;"
        );
}


/* =========================================================
   30. BUTTON EFFECT
   ========================================================= */

function setupButtonEffects() {

    document.addEventListener(
        "click",
        event => {

            const button =
                event.target.closest(
                    "button"
                );


            if (!button) {
                return;
            }


            button.classList.add(
                "button-clicked"
            );


            setTimeout(
                () => {

                    button.classList.remove(
                        "button-clicked"
                    );

                },
                180
            );
        }
    );
}


/* =========================================================
   31. OFFER LETTER REQUIREMENT
   ========================================================= */

function updateOfferLetterRequirement() {

    const scheme =
        document.getElementById(
            "scheme"
        );


    const offerGroup =
        document.getElementById(
            "offerLetterGroup"
        );


    const offerInput =
        document.getElementById(
            "offerLetter"
        );


    if (
        !scheme ||
        !offerGroup ||
        !offerInput
    ) {
        return;
    }


    if (scheme.value === "NOS") {

        offerGroup.classList.remove(
            "hidden"
        );

        offerInput.required = true;

    } else {

        offerGroup.classList.add(
            "hidden"
        );

        offerInput.required = false;

        offerInput.value = "";
    }
}


/* =========================================================
   32. SET SCHEME
   ========================================================= */

function setScheme(
    scheme
) {

    const schemeInput =
        document.getElementById(
            "scheme"
        );


    if (!schemeInput) {
        return;
    }


    schemeInput.value =
        scheme;


    updateOfferLetterRequirement();

    runPreCheck();
}


/* =========================================================
   33. SHOW PAGE
   ========================================================= */

async function showPage(
    pageId
) {

    const protectedPages = [

        "applyPage",

        "trackPage",

        "officerPage"

    ];


    if (
        protectedPages.includes(
            pageId
        )
    ) {

        const loggedIn =
            await requireLogin();


        if (!loggedIn) {
            return;
        }
    }


    if (
        pageId === "officerPage"
    ) {

        const officer =
            await requireOfficer();


        if (!officer) {
            return;
        }
    }


    document
        .querySelectorAll(
            ".page"
        )
        .forEach(
            page => {

                page.classList.remove(
                    "active"
                );

                page.classList.add(
                    "hidden"
                );
            }
        );


    const target =
        document.getElementById(
            pageId
        );


    if (!target) {

        console.warn(
            "Page not found:",
            pageId
        );

        return;
    }


    target.classList.remove(
        "hidden"
    );


    target.classList.add(
        "active"
    );


    document
        .querySelectorAll(
            "[data-page]"
        )
        .forEach(
            button => {

                button.classList.toggle(
                    "active",
                    button.dataset.page ===
                        pageId
                );
            }
        );


    if (
        pageId === "applyPage"
    ) {

        updateApplicationEmail();

        updateOfferLetterRequirement();

        runPreCheck();
    }


    if (
        pageId === "officerPage"
    ) {

        await renderAdmin();
    }


    if (
        pageId === "homePage"
    ) {

        await updateHomeStats();
    }
}


/* =========================================================
   34. INITIALIZATION
   ========================================================= */

document.addEventListener(
    "DOMContentLoaded",
    async () => {

        console.log(
            "TribalScholar initialized."
        );


        console.log(
            "Supabase library:",
            window.supabase
        );


        console.log(
            "Supabase URL:",
            SUPABASE_URL
        );


        console.log(
            "Publishable key loaded:",
            SUPABASE_PUBLISHABLE_KEY.startsWith(
                "sb_publishable_"
            )
        );


        setupNavigation();

        setupReadinessListeners();

        setupButtonEffects();

        updateOfferLetterRequirement();

        runPreCheck();


        const applicationForm =
            document.getElementById(
                "applicationForm"
            );


        if (applicationForm) {

            applicationForm.addEventListener(
                "submit",
                submitApplication
            );
        }


        const trackForm =
            document.getElementById(
                "trackForm"
            );


        if (trackForm) {

            trackForm.addEventListener(
                "submit",
                trackApplication
            );
        }


        await loadCurrentUser();

        updateApplicationEmail();

        updateHomeStats();
    }
);