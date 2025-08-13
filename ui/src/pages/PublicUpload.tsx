import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { MenuUpload } from '@/components/MenuUpload';
import { UrlUpload } from '@/components/UrlUpload';
import { Header } from '@/components/Header';
import { useAuth } from '@/lib/auth-context';
import { useTranslation } from 'react-i18next';
import { Upload, Link, CheckCircle, AlertCircle, ChefHat, Zap, Shield } from 'lucide-react';
import ReCAPTCHA from 'react-google-recaptcha';
import { api, uploadPublicMenu, parsePublicUrl } from '@/lib/serverComm';
import { useDocumentStatusPoll } from '@/hooks/useDocumentStatusPoll';

export function PublicUpload() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const recaptchaRef = useRef<ReCAPTCHA>(null);

  const [activeTab, setActiveTab] = useState('pdf');
  const [recaptchaVerified, setRecaptchaVerified] = useState(false);
  const [uploadInProgress, setUploadInProgress] = useState(false);
  const [uploadResult, setUploadResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [lastDocumentId, setLastDocumentId] = useState<string | null>(null);
  const { status, isPolling, start: startPolling } = useDocumentStatusPoll(lastDocumentId);

  const handleRecaptchaChange = (token: string | null) => {
    setRecaptchaVerified(!!token);
  };

  const handleFileUpload = async (files: File[]) => {
    if (files.length === 0) {
      return;
    }

    const file = files[0];
    // Client-side file size validation (10MB)
    const maxSizeBytes = 10 * 1024 * 1024;
    if (typeof file.size === 'number' && file.size > maxSizeBytes) {
      setUploadResult({
        success: false,
        message: t('publicUpload.fileTooLarge', 'Maximum upload size is 10 MB')
      });
      return;
    }
    
    // Skip reCAPTCHA in development mode or if no site key is configured
    const isDev = import.meta.env.DEV || !import.meta.env.VITE_RECAPTCHA_SITE_KEY;
    
    if (!user && !recaptchaVerified && !isDev) {
      setUploadResult({
        success: false,
        message: t('publicUpload.recaptchaRequired', 'Please complete the reCAPTCHA verification to proceed.')
      });
      return;
    }

    setUploadInProgress(true);
    setUploadResult(null);

    try {
      let response: any;
      
      if (user) {
        // Authenticated upload path
        const fileContent = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            const base64Content = result.split(',')[1];
            resolve(base64Content);
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        response = await api.uploadMenu({ file: { name: file.name, size: file.size, type: file.type, content: fileContent } });
        if (response?.documentId) {
          setLastDocumentId(response.documentId);
          startPolling();
        }
      } else {
        // For public uploads, use the public API
        const recaptchaToken = recaptchaRef.current?.getValue() || 'dev-token';
        response = await uploadPublicMenu(file, recaptchaToken);
      }
      
      if (response.success) {
        if (user) {
          setUploadResult({
            success: true,
            message: t('publicUpload.uploadSuccess', 'Upload successful! Check your dashboard for analysis results.')
          });
          // Optionally start polling document status for feedback
          // We keep UX simple: redirect CTA shown below
        } else {
          // Redirect to restaurant details page for public uploads
          navigate(`/restaurant-details/${response.uploadId}`);
        }
      } else {
        setUploadResult({
          success: false,
          message: response.message || t('publicUpload.uploadError', 'Upload failed. Please try again.')
        });
      }

      // Reset reCAPTCHA for next upload
      if (!user) {
        recaptchaRef.current?.reset();
        setRecaptchaVerified(false);
      }
    } catch (error: any) {
      let errorMessage = t('publicUpload.uploadError', 'Upload failed. Please try again.');
      
      if (error.status === 429) {
        errorMessage = t('publicUpload.rateLimitError', 'Too many uploads. Please wait before trying again.');
      } else if (error.status === 413) {
        errorMessage = t('publicUpload.fileTooLarge', 'Maximum upload size is 10 MB');
      } else if (error.message?.includes('reCAPTCHA')) {
        errorMessage = t('publicUpload.recaptchaError', 'reCAPTCHA verification failed. Please try again.');
      }
      
      setUploadResult({
        success: false,
        message: errorMessage
      });
    } finally {
      setUploadInProgress(false);
    }
  };

  const handleUrlUpload = async (urlData: { url: string }) => {
    // Skip reCAPTCHA in development mode or if no site key is configured
    const isDev = import.meta.env.DEV || !import.meta.env.VITE_RECAPTCHA_SITE_KEY;
    
    if (!user && !recaptchaVerified && !isDev) {
      setUploadResult({
        success: false,
        message: t('publicUpload.recaptchaRequired', 'Please complete the reCAPTCHA verification to proceed.')
      });
      return;
    }

    setUploadInProgress(true);
    setUploadResult(null);

    try {
      let response: any;
      
      if (user) {
        // Authenticated URL parse path
        response = await api.uploadMenuUrl({ url: urlData.url, restaurant: { name: '' } });
        if (response?.documentId) {
          setLastDocumentId(response.documentId);
          startPolling();
        }
      } else {
        // For public uploads, use the public API
        const recaptchaToken = recaptchaRef.current?.getValue() || 'dev-token';
        response = await parsePublicUrl(urlData.url, recaptchaToken);
      }
      
      if (response.success) {
        if (user) {
          setUploadResult({
            success: true,
            message: t('publicUpload.uploadSuccess', 'Upload successful! Check your dashboard for analysis results.')
          });
        } else {
          // Redirect to restaurant details page for public uploads
          navigate(`/restaurant-details/${response.uploadId}`);
        }
      } else {
        setUploadResult({
          success: false,
          message: response.message || t('publicUpload.uploadError', 'URL parsing failed. Please try again.')
        });
      }

      // Reset reCAPTCHA for next upload
      if (!user) {
        recaptchaRef.current?.reset();
        setRecaptchaVerified(false);
      }
    } catch (error: any) {
      let errorMessage = t('publicUpload.uploadError', 'URL parsing failed. Please try again.');
      
      if (error.status === 429) {
        errorMessage = t('publicUpload.rateLimitError', 'Too many uploads. Please wait before trying again.');
      } else if (error.message?.includes('reCAPTCHA')) {
        errorMessage = t('publicUpload.recaptchaError', 'reCAPTCHA verification failed. Please try again.');
      }
      
      setUploadResult({
        success: false,
        message: errorMessage
      });
    } finally {
      setUploadInProgress(false);
    }
  };

  const features = [
    {
      icon: Zap,
      title: t('publicUpload.features.instant.title', 'Instant Analysis'),
      description: t('publicUpload.features.instant.description', 'Get immediate insights from your menu')
    },
    {
      icon: Shield,
      title: t('publicUpload.features.secure.title', 'Secure & Private'),
      description: t('publicUpload.features.secure.description', 'Your data is protected and confidential')
    },
    {
      icon: CheckCircle,
      title: t('publicUpload.features.noCommitment.title', 'No Commitment'),
      description: t('publicUpload.features.noCommitment.description', 'Try our service risk-free')
    }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-secondary/5">
      <Header 
        onSignIn={() => navigate('/login')}
        onGetStarted={() => navigate('/upload')}
      />
      
      <div className="container mx-auto px-4 py-16">
        {/* Hero Section */}
        <div className="text-center max-w-3xl mx-auto mb-12">
          <div className="flex items-center justify-center space-x-2 mb-4">
            <ChefHat className="h-12 w-12 text-primary" />
            <span className="text-3xl font-bold">
              {t('publicUpload.brand', 'Menu Insights')}
            </span>
          </div>
          <h1 className="text-4xl font-bold mb-4">
            {t('publicUpload.title', 'Upload Your Menu for Free Analysis')}
          </h1>
          <p className="text-xl text-muted-foreground mb-8">
            {t('publicUpload.subtitle', 'Get instant AI-powered insights to optimize your menu and boost revenue. No signup required to try!')}
          </p>
          
          {/* Features */}
          <div className="grid md:grid-cols-3 gap-6 mb-12">
            {features.map((feature, index) => (
              <div key={index} className="text-center">
                <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mx-auto mb-3">
                  <feature.icon className="h-6 w-6 text-primary" />
                </div>
                <h3 className="font-semibold mb-1">{feature.title}</h3>
                <p className="text-sm text-muted-foreground">{feature.description}</p>
              </div>
            ))}
          </div>

          {user && (
            <Alert className="mb-8">
              <CheckCircle className="h-4 w-4" />
              <AlertDescription>
                {t('publicUpload.loggedInMessage', 'You are logged in! Uploads will be saved to your dashboard automatically.')}
              </AlertDescription>
            </Alert>
          )}
        </div>

        {/* Upload Interface */}
        <div className="max-w-4xl mx-auto">
          <Card>
            <CardHeader>
              <CardTitle className="text-center">
                {t('publicUpload.uploadTitle', 'Choose Your Upload Method')}
              </CardTitle>
              <CardDescription className="text-center">
                {t('publicUpload.uploadDescription', 'Upload a PDF menu or provide a restaurant website URL for analysis')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="pdf" className="flex items-center gap-2">
                    <Upload className="h-4 w-4" />
                    {t('publicUpload.tabs.pdf', 'Upload PDF')}
                  </TabsTrigger>
                  <TabsTrigger value="url" className="flex items-center gap-2">
                    <Link className="h-4 w-4" />
                    {t('publicUpload.tabs.url', 'Website URL')}
                  </TabsTrigger>
                </TabsList>
                
                <TabsContent value="pdf" className="space-y-6">
                  <MenuUpload 
                    onFileUpload={handleFileUpload}
                    isPublicMode={!user}
                    disabled={uploadInProgress}
                  />
                </TabsContent>
                
                <TabsContent value="url" className="space-y-6">
                  <UrlUpload 
                    onUrlUpload={handleUrlUpload}
                    isPublicMode={!user}
                    disabled={uploadInProgress}
                  />
                </TabsContent>

                {/* reCAPTCHA for non-authenticated users */}
                {!user && import.meta.env.VITE_RECAPTCHA_SITE_KEY && !import.meta.env.DEV && (
                  <div className="flex justify-center mt-6">
                    <ReCAPTCHA
                      ref={recaptchaRef}
                      sitekey={import.meta.env.VITE_RECAPTCHA_SITE_KEY}
                      onChange={handleRecaptchaChange}
                      theme="light"
                    />
                  </div>
                )}

                {/* Development mode notice */}
                {!user && (import.meta.env.DEV || !import.meta.env.VITE_RECAPTCHA_SITE_KEY) && (
                  <div className="text-center mt-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                    <p className="text-sm text-yellow-800">
                      🔧 {t('publicUpload.devMode', 'Development Mode: reCAPTCHA verification is disabled')}
                    </p>
                  </div>
                )}

                {/* Upload Result */}
                {uploadResult && (
                  <Alert className={uploadResult.success ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}>
                    {uploadResult.success ? (
                      <CheckCircle className="h-4 w-4 text-green-600" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-red-600" />
                    )}
                    <AlertDescription className={uploadResult.success ? 'text-green-800' : 'text-red-800'}>
                      {uploadResult.message}
                    </AlertDescription>
                  </Alert>
                )}

                {user && lastDocumentId && (
                  <div className="mt-4 text-center text-sm text-muted-foreground">
                    {isPolling ? (
                      <span>Processing in progress...</span>
                    ) : status ? (
                      <span>Processing {status.document.status}</span>
                    ) : null}
                  </div>
                )}

                {/* Call to Action for Public Users */}
                {!user && (
                  <div className="text-center mt-8 pt-6 border-t">
                    <p className="text-muted-foreground mb-4">
                      {t('publicUpload.cta.message', 'Want to save your analyses and access advanced features?')}
                    </p>
                    <Button onClick={() => navigate('/login')} size="lg">
                      {t('publicUpload.cta.button', 'Create Free Account')}
                    </Button>
                  </div>
                )}

                {user && uploadResult?.success && (
                  <div className="text-center mt-8 pt-6 border-t">
                    <Button onClick={() => navigate('/dashboard/menu-insights')} size="lg">
                      {t('publicUpload.goToMenus', 'Go to My Menus')}
                    </Button>
                  </div>
                )}
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}